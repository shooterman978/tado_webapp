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

export function fetchHealth(): Promise<HealthStatus> {
  return getJson<HealthStatus>("/api/health");
}

export function fetchZones(): Promise<ZonesResponse> {
  return getJson<ZonesResponse>("/api/zones");
}
