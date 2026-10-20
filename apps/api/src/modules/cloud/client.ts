/**
 * Lightweight Tado cloud client — OAuth device-code, metadata, Smart Schedule.
 * Live temperature control stays on the local HomeKit bridge.
 *
 * Every HTTP call to Tado cloud goes through {@link cloudFetch} and counts
 * against the central CloudQuota budget.
 *
 * Official hobbyist client_id (device code grant):
 * https://help.tado.com/en/articles/8565472-how-do-i-authenticate-to-access-the-rest-api
 *
 * @package @heizplan/api
 */

import type {
  AwayConfiguration,
  ScheduleBlock,
  ScheduleDayType,
  TimetableKind,
  ZoneSchedule,
} from "@heizplan/shared";
import {
  consumeCloudQuota,
  noteCloudRateLimitHeaders,
  runCloudRequestGroup,
} from "./quota.js";
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

interface TimetableTypeResponse {
  id: 0 | 1 | 2;
  type: TimetableKind;
}

interface RawTimetableBlock {
  dayType: ScheduleDayType;
  start: string;
  end: string;
  geolocationOverride?: boolean;
  setting?: {
    type?: string;
    power?: "ON" | "OFF";
    temperature?: { celsius?: number | null };
  };
}

interface RawAwayConfiguration {
  type?: string;
  setting?: {
    type?: string;
    power?: "ON" | "OFF";
    temperature?: { celsius?: number | null };
  };
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

/** Safe path for quota log — host stripped, query dropped (no tokens). */
function logPathFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname || "/";
  } catch {
    return url.split("?")[0] ?? "/";
  }
}

function labelForCloudCall(method: string, pathname: string): string {
  const m = method.toUpperCase();
  if (pathname.includes("/oauth2/device_authorize")) {
    return "auth.device_authorize";
  }
  if (pathname.includes("/oauth2/token")) {
    return "auth.token";
  }
  if (pathname.endsWith("/me")) {
    return "metadata.me";
  }
  if (/\/homes\/\d+\/zones$/.test(pathname)) {
    return "metadata.zones";
  }
  if (pathname.includes("/zoneStates")) {
    return "openWindow.zoneStates";
  }
  if (/\/homes\/\d+\/state$/.test(pathname)) {
    return "presence.homeState";
  }
  if (pathname.includes("/activeTimetable")) {
    return m === "PUT" ? "schedule.activeTimetable.put" : "schedule.activeTimetable";
  }
  if (pathname.includes("/awayConfiguration")) {
    return m === "PUT" ? "schedule.away.put" : "schedule.away";
  }
  if (pathname.includes("/blocks")) {
    return m === "PUT" ? "schedule.blocks.put" : "schedule.blocks";
  }
  if (pathname.includes("/timetables/")) {
    return "schedule.timetable";
  }
  return `cloud.${m.toLowerCase()}`;
}

/**
 * Single egress point for Tado cloud HTTP — consumes quota, never logs tokens.
 */
async function cloudFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const pathName = logPathFromUrl(url);
  await consumeCloudQuota(1, {
    method,
    path: pathName,
    label: labelForCloudCall(method, pathName),
  });
  const headers = new Headers(init.headers);
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }
  const res = await fetch(url, { ...init, headers });
  try {
    await noteCloudRateLimitHeaders(res.headers);
  } catch {
    /* ignore header bookkeeping failures */
  }
  return res;
}

async function postForm(
  url: string,
  params: Record<string, string>,
): Promise<Response> {
  const body = new URLSearchParams(params);
  return cloudFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
}

export { runCloudRequestGroup };

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
  const res = await cloudFetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Tado API ${path} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

async function apiPut<T>(
  accessToken: string,
  path: string,
  body: unknown,
): Promise<T | null> {
  const res = await cloudFetch(`${API_BASE}${path}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json;charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Tado API PUT ${path} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  if (res.status === 204) {
    return null;
  }
  const text = await res.text().catch(() => "");
  if (!text) {
    return null;
  }
  return JSON.parse(text) as T;
}

/**
 * Fetch home zones and build serial → room-name metadata.
 * Control stays local; this is names / grouping only.
 */
export async function fetchZoneMetadata(
  accessToken: string,
): Promise<ZoneMetadata> {
  return runCloudRequestGroup("Metadaten sync", async () => {
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
  });
}

interface CloudZoneState {
  openWindowDetected?: boolean | null;
  openWindow?: unknown;
}

interface CloudZoneStatesResponse {
  zoneStates?: Record<string, CloudZoneState>;
}

/** Raw Tado home presence from GET /homes/{id}/state. */
export interface TadoHomeState {
  presence: "HOME" | "AWAY";
  presenceLocked?: boolean;
  showHomePresenceSwitchButton?: boolean;
}

/**
 * Sparse Home/Away read — one quota unit via cloudFetch.
 * Does not mutate presenceLock (read-only).
 */
export async function fetchHomeState(
  accessToken: string,
  homeId: number,
): Promise<TadoHomeState> {
  return apiGet<TadoHomeState>(accessToken, `/homes/${homeId}/state`);
}

/**
 * Optional read of cloud open-window flags (detection only — control stays local).
 * Maps cloud zoneId → open (true when openWindowDetected or openWindow present).
 */
export async function fetchOpenWindowByZoneId(
  accessToken: string,
  homeId: number,
): Promise<Record<number, boolean>> {
  const payload = await apiGet<CloudZoneStatesResponse>(
    accessToken,
    `/homes/${homeId}/zoneStates`,
  );
  const out: Record<number, boolean> = {};
  for (const [id, state] of Object.entries(payload.zoneStates ?? {})) {
    const zoneId = Number(id);
    if (!Number.isFinite(zoneId)) {
      continue;
    }
    const detected =
      state?.openWindowDetected === true ||
      (state?.openWindow != null && state.openWindow !== false);
    out[zoneId] = detected;
  }
  return out;
}

function mapBlock(raw: RawTimetableBlock): ScheduleBlock {
  const power = raw.setting?.power === "OFF" ? "OFF" : "ON";
  const celsius = raw.setting?.temperature?.celsius;
  return {
    dayType: raw.dayType,
    start: normalizeTime(raw.start),
    end: normalizeTime(raw.end),
    power,
    tempC:
      power === "OFF"
        ? null
        : typeof celsius === "number"
          ? celsius
          : null,
    geolocationOverride: Boolean(raw.geolocationOverride),
  };
}

function normalizeTime(value: string): string {
  const m = value?.match(/^(\d{1,2}):(\d{2})/);
  if (!m) {
    return "00:00";
  }
  return `${String(Number(m[1])).padStart(2, "0")}:${m[2]}`;
}

function toRawBlock(block: ScheduleBlock): RawTimetableBlock {
  const power = block.power === "OFF" ? "OFF" : "ON";
  const setting: RawTimetableBlock["setting"] = {
    type: "HEATING",
    power,
  };
  if (power === "ON") {
    setting.temperature = {
      celsius: typeof block.tempC === "number" ? block.tempC : 20,
    };
  }
  return {
    dayType: block.dayType,
    start: normalizeTime(block.start),
    end: normalizeTime(block.end) === "24:00" ? "00:00" : normalizeTime(block.end),
    geolocationOverride: Boolean(block.geolocationOverride),
    setting,
  };
}

function mapAway(raw: RawAwayConfiguration | null | undefined): AwayConfiguration {
  const power = raw?.setting?.power === "OFF" ? "OFF" : "ON";
  const celsius = raw?.setting?.temperature?.celsius;
  return {
    power,
    tempC:
      power === "OFF"
        ? null
        : typeof celsius === "number"
          ? celsius
          : 5,
  };
}

const DAY_TYPES_BY_TIMETABLE: Record<0 | 1 | 2, ScheduleDayType[]> = {
  0: ["MONDAY_TO_SUNDAY"],
  1: ["MONDAY_TO_FRIDAY", "SATURDAY", "SUNDAY"],
  2: [
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
    "SATURDAY",
    "SUNDAY",
  ],
};

export function dayTypesForTimetable(
  timetableTypeId: 0 | 1 | 2,
): ScheduleDayType[] {
  return DAY_TYPES_BY_TIMETABLE[timetableTypeId];
}

/**
 * Load Smart Schedule (active Home timetable + Away config) for a cloud zone.
 * Uses 2–3 cloud requests depending on timetable size.
 */
export async function fetchZoneSchedule(
  accessToken: string,
  homeId: number,
  cloudZoneId: number,
  roomId: string,
  zoneName: string,
): Promise<ZoneSchedule> {
  return runCloudRequestGroup("Schedule lesen", async () => {
    const active = await apiGet<TimetableTypeResponse>(
      accessToken,
      `/homes/${homeId}/zones/${cloudZoneId}/schedule/activeTimetable`,
    );
    const timetableTypeId = (active?.id ?? 1) as 0 | 1 | 2;
    const timetableType = (active?.type ??
      (timetableTypeId === 0
        ? "ONE_DAY"
        : timetableTypeId === 2
          ? "SEVEN_DAY"
          : "THREE_DAY")) as TimetableKind;

    const rawBlocks = await apiGet<RawTimetableBlock[]>(
      accessToken,
      `/homes/${homeId}/zones/${cloudZoneId}/schedule/timetables/${timetableTypeId}/blocks`,
    );

    let awayRaw: RawAwayConfiguration | null = null;
    try {
      awayRaw = await apiGet<RawAwayConfiguration>(
        accessToken,
        `/homes/${homeId}/zones/${cloudZoneId}/schedule/awayConfiguration`,
      );
    } catch {
      awayRaw = null;
    }

    return {
      roomId,
      cloudZoneId,
      zoneName,
      timetableType,
      timetableTypeId,
      homeBlocks: (rawBlocks ?? []).map(mapBlock),
      away: mapAway(awayRaw),
      fetchedAt: new Date().toISOString(),
    };
  });
}

/** Replace all Home timetable blocks for one dayType (visible in official Tado app). */
export async function putHomeDayBlocks(
  accessToken: string,
  homeId: number,
  cloudZoneId: number,
  timetableTypeId: 0 | 1 | 2,
  dayType: ScheduleDayType,
  blocks: ScheduleBlock[],
): Promise<ScheduleBlock[]> {
  const payload = blocks.map((b) =>
    toRawBlock({ ...b, dayType }),
  );
  const saved = await apiPut<RawTimetableBlock[]>(
    accessToken,
    `/homes/${homeId}/zones/${cloudZoneId}/schedule/timetables/${timetableTypeId}/blocks/${dayType}`,
    payload,
  );
  return (saved ?? payload).map(mapBlock);
}

/** Switch active timetable type (ONE_DAY / THREE_DAY / SEVEN_DAY). */
export async function putActiveTimetable(
  accessToken: string,
  homeId: number,
  cloudZoneId: number,
  timetableTypeId: 0 | 1 | 2,
): Promise<TimetableTypeResponse> {
  const type: TimetableKind =
    timetableTypeId === 0
      ? "ONE_DAY"
      : timetableTypeId === 2
        ? "SEVEN_DAY"
        : "THREE_DAY";
  const saved = await apiPut<TimetableTypeResponse>(
    accessToken,
    `/homes/${homeId}/zones/${cloudZoneId}/schedule/activeTimetable`,
    { id: timetableTypeId, type },
  );
  return saved ?? { id: timetableTypeId, type };
}

/** Persist Away setpoint (official app Away tab). */
export async function putAwayConfiguration(
  accessToken: string,
  homeId: number,
  cloudZoneId: number,
  away: AwayConfiguration,
): Promise<AwayConfiguration> {
  const power = away.power === "OFF" ? "OFF" : "ON";
  const body: RawAwayConfiguration = {
    type: "HEATING",
    setting: {
      type: "HEATING",
      power,
      ...(power === "ON"
        ? { temperature: { celsius: away.tempC ?? 5 } }
        : {}),
    },
  };
  await apiPut(
    accessToken,
    `/homes/${homeId}/zones/${cloudZoneId}/schedule/awayConfiguration`,
    body,
  );
  return { power, tempC: power === "OFF" ? null : (away.tempC ?? 5) };
}
