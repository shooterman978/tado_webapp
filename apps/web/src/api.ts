import type {
  CloudAuthPollResult,
  CloudAuthStart,
  CloudQuotaStatus,
  CloudStatus,
  HealthStatus,
  OpenWindowSettings,
  ZoneSchedule,
  ZoneScheduleUpdate,
  ZonesResponse,
} from "@heizplan/shared";

export class ApiError extends Error {
  readonly status: number;
  readonly quota?: CloudQuotaStatus;

  constructor(message: string, status: number, quota?: CloudQuotaStatus) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.quota = quota;
  }
}

async function parseError(res: Response): Promise<ApiError> {
  const errBody = (await res.json().catch(() => null)) as {
    message?: string;
    quota?: CloudQuotaStatus;
  } | null;
  return new ApiError(
    errBody?.message ?? `Request failed (${res.status})`,
    res.status,
    errBody?.quota,
  );
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw await parseError(res);
  }
  return res.json() as Promise<T>;
}

async function postJson(
  path: string,
  body?: unknown,
): Promise<void> {
  const res = await fetch(path, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    throw await parseError(res);
  }
}

async function putJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw await parseError(res);
  }
  return res.json() as Promise<T>;
}

async function postJsonResult<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    throw await parseError(res);
  }
  return res.json() as Promise<T>;
}

export function fetchHealth(): Promise<HealthStatus> {
  return getJson<HealthStatus>("/api/health");
}

export function fetchZones(): Promise<ZonesResponse> {
  return getJson<ZonesResponse>("/api/zones");
}

export async function setZoneTemperature(
  zoneId: string,
  tempC: number,
  durationMinutes?: number | null,
): Promise<void> {
  await postJson(`/api/zones/${encodeURIComponent(zoneId)}/temperature`, {
    tempC,
    durationMinutes: durationMinutes ?? null,
  });
}

export async function clearZoneOverlay(zoneId: string): Promise<void> {
  await postJson(`/api/zones/${encodeURIComponent(zoneId)}/overlay/clear`);
}

export async function setZonePower(
  zoneId: string,
  mode: "heat" | "off",
): Promise<void> {
  await postJson(`/api/zones/${encodeURIComponent(zoneId)}/power`, { mode });
}

export async function runQuickAction(
  action: "off" | "boost" | "resume",
): Promise<void> {
  await postJson(`/api/zones/quick-actions/${action}`);
}

export function fetchOpenWindowSettings(): Promise<OpenWindowSettings> {
  return getJson<OpenWindowSettings>("/api/zones/settings/open-window");
}

export function saveOpenWindowSettings(
  settings: Partial<OpenWindowSettings>,
): Promise<OpenWindowSettings> {
  return putJson<OpenWindowSettings>(
    "/api/zones/settings/open-window",
    settings,
  );
}

export async function setZoneWindowOpen(
  zoneId: string,
  open: boolean,
): Promise<void> {
  await postJson(`/api/zones/${encodeURIComponent(zoneId)}/window`, { open });
}

export function fetchCloudStatus(): Promise<CloudStatus> {
  return getJson<CloudStatus>("/api/cloud/status");
}

export function startCloudAuth(): Promise<CloudAuthStart> {
  return postJsonResult<CloudAuthStart>("/api/cloud/auth/start");
}

export async function pollCloudAuth(): Promise<CloudAuthPollResult> {
  const res = await fetch("/api/cloud/auth/poll", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
  });
  // 202 = still pending — not an error for the device-code flow.
  if (!res.ok && res.status !== 202) {
    throw await parseError(res);
  }
  return res.json() as Promise<CloudAuthPollResult>;
}

export function syncCloudMetadata(): Promise<{
  ok: boolean;
  syncedAt: string;
  homeName: string;
  deviceCount: number;
  cloud: CloudStatus;
}> {
  return postJsonResult("/api/cloud/sync");
}

export function fetchCloudQuota(): Promise<CloudQuotaStatus> {
  return getJson<CloudQuotaStatus>("/api/cloud/quota");
}

export function saveCloudQuotaLimit(limit: number): Promise<CloudQuotaStatus> {
  return putJson<CloudQuotaStatus>("/api/cloud/quota", { limit });
}

export function fetchZoneSchedule(roomId: string): Promise<{
  schedule: ZoneSchedule;
  quota: CloudQuotaStatus;
}> {
  return getJson(`/api/cloud/schedule/${encodeURIComponent(roomId)}`);
}

export function syncZoneSchedule(roomId: string): Promise<{
  ok: boolean;
  schedule: ZoneSchedule;
  quota: CloudQuotaStatus;
}> {
  return postJsonResult(`/api/cloud/schedule/${encodeURIComponent(roomId)}/sync`);
}

export function saveZoneSchedule(
  roomId: string,
  update: ZoneScheduleUpdate,
): Promise<{
  schedule: ZoneSchedule;
  quota: CloudQuotaStatus;
  presence: "HOME" | "AWAY";
}> {
  return putJson(`/api/cloud/schedule/${encodeURIComponent(roomId)}`, update);
}
