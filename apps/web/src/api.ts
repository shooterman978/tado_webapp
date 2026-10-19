import type { HealthStatus, ZonesResponse } from "@heizplan/shared";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Request failed (${res.status}) ${path}`);
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
    const errBody = (await res.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(errBody?.message ?? `Aktion fehlgeschlagen (${res.status})`);
  }
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
