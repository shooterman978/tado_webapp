import type {
  CalendarConnectionStatus,
  CalendarConnectionUpdate,
  CalendarEvaluateResult,
  CalendarEventsResponse,
  CalendarRule,
  CalendarStatusResponse,
  CloudAuthPollResult,
  CloudAuthStart,
  CloudQuotaLogResponse,
  CloudQuotaStatus,
  CloudStatus,
  CloudSyncStatus,
  HealthStatus,
  HeatupPrediction,
  HeatupRoomSummary,
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

/** Disk-only sync bookmark (no cloud HTTP). */
export function fetchCloudSyncStatus(): Promise<CloudSyncStatus> {
  return getJson<CloudSyncStatus>("/api/cloud/sync");
}

/** Explicit home cloud sync (metadata + openWindow). Does not pull schedules. */
export function syncCloudHome(): Promise<{
  ok: boolean;
  syncedAt: string;
  homeName: string;
  deviceCount: number;
  openWindowCount: number;
  cloud: CloudStatus;
  sync: CloudSyncStatus;
  quota: CloudQuotaStatus;
}> {
  return postJsonResult("/api/cloud/sync");
}

/** @deprecated Prefer {@link syncCloudHome}. */
export function syncCloudMetadata(): Promise<{
  ok: boolean;
  syncedAt: string;
  homeName: string;
  deviceCount: number;
  cloud: CloudStatus;
  sync?: CloudSyncStatus;
  quota?: CloudQuotaStatus;
}> {
  return syncCloudHome();
}

export function fetchCloudQuota(): Promise<CloudQuotaStatus> {
  return getJson<CloudQuotaStatus>("/api/cloud/quota");
}

export function fetchCloudQuotaLog(opts?: {
  todayOnly?: boolean;
  limit?: number;
}): Promise<CloudQuotaLogResponse> {
  const params = new URLSearchParams();
  if (opts?.todayOnly === false) {
    params.set("today", "0");
  }
  if (opts?.limit != null) {
    params.set("limit", String(opts.limit));
  }
  const q = params.toString();
  return getJson<CloudQuotaLogResponse>(
    `/api/cloud/quota/log${q ? `?${q}` : ""}`,
  );
}

export function saveCloudQuotaLimit(limit: number): Promise<CloudQuotaStatus> {
  return putJson<CloudQuotaStatus>("/api/cloud/quota", { limit });
}

/** Local schedule cache only — never hits Tado cloud. */
export function fetchZoneSchedule(roomId: string): Promise<{
  schedule: ZoneSchedule;
  quota: CloudQuotaStatus;
  fromCache: boolean;
}> {
  return getJson(`/api/cloud/schedule/${encodeURIComponent(roomId)}`);
}

/** Explicit room schedule pull from Tado cloud. */
export function syncZoneSchedule(roomId: string): Promise<{
  ok: boolean;
  schedule: ZoneSchedule;
  quota: CloudQuotaStatus;
  fromCache: boolean;
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

export function fetchCalendarStatus(): Promise<CalendarStatusResponse> {
  return getJson<CalendarStatusResponse>("/api/calendar/status");
}

export function fetchCalendarConnection(): Promise<CalendarConnectionStatus> {
  return getJson<CalendarConnectionStatus>("/api/calendar/connection");
}

export function saveCalendarConnection(
  body: CalendarConnectionUpdate,
): Promise<CalendarConnectionStatus> {
  return putJson<CalendarConnectionStatus>("/api/calendar/connection", body);
}

export async function deleteCalendarConnection(): Promise<CalendarConnectionStatus> {
  const res = await fetch("/api/calendar/connection", {
    method: "DELETE",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw await parseError(res);
  }
  return res.json() as Promise<CalendarConnectionStatus>;
}

export function refreshCalendarConnection(): Promise<CalendarConnectionStatus> {
  return postJsonResult<CalendarConnectionStatus>("/api/calendar/connection/refresh");
}

export function createCalendarRule(
  body: Partial<CalendarRule>,
): Promise<CalendarRule> {
  return postJsonResult<CalendarRule>("/api/calendar/rules", body);
}

export function updateCalendarRule(
  id: string,
  body: Partial<CalendarRule>,
): Promise<CalendarRule> {
  return putJson<CalendarRule>(`/api/calendar/rules/${encodeURIComponent(id)}`, body);
}

export async function deleteCalendarRule(id: string): Promise<void> {
  const res = await fetch(`/api/calendar/rules/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw await parseError(res);
  }
}

export function evaluateCalendarRules(): Promise<CalendarEvaluateResult> {
  return postJsonResult<CalendarEvaluateResult>("/api/calendar/evaluate");
}

export function fetchCalendarEvents(): Promise<CalendarEventsResponse> {
  return getJson<CalendarEventsResponse>("/api/calendar/events");
}

export function saveCalendarEventSelection(
  selectedUids: string[],
): Promise<CalendarEventsResponse> {
  return putJson<CalendarEventsResponse>("/api/calendar/events/selection", {
    selectedUids,
  });
}

export function fetchHeatupSummary(
  roomId: string,
  opts?: { currentTempC?: number | null; targetTempC?: number },
): Promise<HeatupRoomSummary> {
  const q = new URLSearchParams();
  if (opts?.currentTempC != null) {
    q.set("currentTempC", String(opts.currentTempC));
  }
  if (opts?.targetTempC != null) {
    q.set("targetTempC", String(opts.targetTempC));
  }
  const qs = q.toString();
  return getJson<HeatupRoomSummary>(
    `/api/heatup/rooms/${encodeURIComponent(roomId)}${qs ? `?${qs}` : ""}`,
  );
}

export function fetchHeatupPrediction(
  roomId: string,
  targetTempC: number,
  opts?: { currentTempC?: number | null; readyAt?: string },
): Promise<HeatupPrediction> {
  const q = new URLSearchParams({ targetTempC: String(targetTempC) });
  if (opts?.currentTempC != null) {
    q.set("currentTempC", String(opts.currentTempC));
  }
  if (opts?.readyAt) {
    q.set("readyAt", opts.readyAt);
  }
  return getJson<HeatupPrediction>(
    `/api/heatup/rooms/${encodeURIComponent(roomId)}/prediction?${q}`,
  );
}

