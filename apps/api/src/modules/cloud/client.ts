/**
 * Lightweight Tado cloud client — OAuth device-code + zone/device metadata only.
 * Live temperature control stays on the local HomeKit bridge.
 *
 * Official hobbyist client_id (device code grant):
 * https://help.tado.com/en/articles/8565472-how-do-i-authenticate-to-access-the-rest-api
 *
 * @package @heizplan/api
 */

import type {
  CloudTokens,
  DeviceZoneMeta,
  PendingDeviceAuth,
  ZoneMetadata,
} from "./store.js";

/** Public tado° open-source / hobbyist OAuth client id (not a secret). */
export const TADO_CLIENT_ID = "1bb50063-6b0c-4d11-bd99-387f4a91cc46";

const AUTH_DEVICE_URL = "https://login.tado.com/oauth2/device_authorize";
const AUTH_TOKEN_URL = "https://login.tado.com/oauth2/token";
const API_BASE = "https://my.tado.com/api/v2";

interface DeviceAuthorizeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface MeResponse {
  homes?: Array<{ id: number; name: string }>;
}

interface CloudZone {
  id: number;
  name: string;
  type?: string;
  devices?: Array<{
    deviceType?: string;
    serialNo?: string;
    shortSerialNo?: string;
  }>;
}

function tokensFromResponse(json: TokenResponse): CloudTokens {
  if (!json.access_token || !json.refresh_token) {
    throw new Error(
      json.error_description ?? json.error ?? "Token response incomplete",
    );
  }
  const expiresIn = Number(json.expires_in) || 600;
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    // Refresh a little early to avoid mid-request expiry.
    expiresAt: Date.now() + Math.max(30, expiresIn - 30) * 1000,
    updatedAt: new Date().toISOString(),
  };
}

async function postForm(
  url: string,
  params: Record<string, string>,
): Promise<Response> {
  const body = new URLSearchParams(params);
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
}

/** Start OAuth device-code flow (user completes browser login once). */
export async function startDeviceAuth(): Promise<{
  pending: PendingDeviceAuth;
  public: {
    userCode: string;
    verificationUri: string;
    verificationUriComplete: string;
    expiresIn: number;
    interval: number;
  };
}> {
  const res = await postForm(AUTH_DEVICE_URL, {
    client_id: TADO_CLIENT_ID,
    scope: "offline_access",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Device authorize failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as DeviceAuthorizeResponse;
  const expiresIn = Number(json.expires_in) || 300;
  const interval = Math.max(5, Number(json.interval) || 5);
  const pending: PendingDeviceAuth = {
    deviceCode: json.device_code,
    userCode: json.user_code,
    verificationUri: json.verification_uri,
    verificationUriComplete: json.verification_uri_complete,
    interval,
    expiresAt: Date.now() + expiresIn * 1000,
    createdAt: new Date().toISOString(),
  };
  return {
    pending,
    public: {
      userCode: pending.userCode,
      verificationUri: pending.verificationUri,
      verificationUriComplete: pending.verificationUriComplete,
      expiresIn,
      interval,
    },
  };
}

export type PollOutcome =
  | { status: "pending" }
  | { status: "expired" }
  | { status: "error"; message: string }
  | { status: "linked"; tokens: CloudTokens };

/** Poll token endpoint until user finishes browser auth (or timeout). */
export async function pollDeviceAuth(
  pending: PendingDeviceAuth,
): Promise<PollOutcome> {
  if (Date.now() > pending.expiresAt) {
    return { status: "expired" };
  }
  const res = await postForm(AUTH_TOKEN_URL, {
    client_id: TADO_CLIENT_ID,
    device_code: pending.deviceCode,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (res.ok && json.access_token) {
    return { status: "linked", tokens: tokensFromResponse(json) };
  }
  const err = json.error ?? "";
  if (
    err === "authorization_pending" ||
    err === "slow_down" ||
    res.status === 400
  ) {
    // 400 with authorization_pending is the normal wait state.
    if (!err || err === "authorization_pending" || err === "slow_down") {
      return { status: "pending" };
    }
    if (err === "expired_token") {
      return { status: "expired" };
    }
    return {
      status: "error",
      message: json.error_description ?? err,
    };
  }
  return {
    status: "error",
    message:
      json.error_description ??
      (err || `Token poll failed (${res.status})`),
  };
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<CloudTokens> {
  const res = await postForm(AUTH_TOKEN_URL, {
    client_id: TADO_CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok) {
    throw new Error(
      json.error_description ?? json.error ?? `Refresh failed (${res.status})`,
    );
  }
  return tokensFromResponse(json);
}

async function apiGet<T>(accessToken: string, path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Tado API ${path} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Fetch home zones and build serial → room-name metadata.
 * Control stays local; this is names / grouping only.
 */
export async function fetchZoneMetadata(
  accessToken: string,
): Promise<ZoneMetadata> {
  const me = await apiGet<MeResponse>(accessToken, "/me");
  const home = me.homes?.[0];
  if (!home?.id) {
    throw new Error("No tado° home linked to this account.");
  }

  const zones = await apiGet<CloudZone[]>(
    accessToken,
    `/homes/${home.id}/zones`,
  );

  const devices: Record<string, DeviceZoneMeta> = {};
  for (const zone of zones) {
    if (!zone?.id || !zone.name) {
      continue;
    }
    // Heating rooms only — skip HOT_WATER etc.
    if (zone.type && zone.type !== "HEATING") {
      continue;
    }
    for (const device of zone.devices ?? []) {
      const serial = device.serialNo?.trim();
      if (!serial) {
        continue;
      }
      const meta: DeviceZoneMeta = {
        zoneId: zone.id,
        zoneName: zone.name,
        serialNo: serial,
        shortSerialNo: device.shortSerialNo,
        deviceType: device.deviceType,
      };
      devices[serial.toUpperCase()] = meta;
      if (device.shortSerialNo) {
        devices[device.shortSerialNo.toUpperCase()] = meta;
      }
    }
  }

  return {
    homeId: home.id,
    homeName: home.name,
    syncedAt: new Date().toISOString(),
    devices,
  };
}
