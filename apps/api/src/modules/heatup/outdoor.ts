/**
 * Outdoor temperature — Bright Sky (DWD) primary, Open-Meteo fallback, stub for tests.
 * Never uses Tado Cloud. In-memory + disk TTL cache under BRIDGE_DATA_DIR/heatup/.
 *
 * @package @heizplan/api
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { OutdoorProviderId } from "@heizplan/shared";
import { config } from "../../config.js";

export interface OutdoorReading {
  tempC: number;
  observedAt: string;
  source: OutdoorProviderId;
  /** When this cache entry was written (ISO). */
  fetchedAt?: string;
}

export interface OutdoorClientOptions {
  provider: OutdoorProviderId;
  fallback: OutdoorProviderId | null;
  lat: number;
  lon: number;
  stubTempC: number;
  /** Inject fetch for tests. */
  fetchImpl?: typeof fetch;
  /** Force stub without network. */
  forceStub?: boolean;
  /** Bypass TTL and hit network. */
  forceRefresh?: boolean;
  /** TTL override (ms). */
  ttlMs?: number;
}

const CACHE_FILE = "outdoor-cache.json";

let lastReading: OutdoorReading | null = null;
let cacheLoaded = false;

export function getLastOutdoorReading(): OutdoorReading | null {
  return lastReading;
}

export function resetOutdoorCache(): void {
  lastReading = null;
  cacheLoaded = false;
}

function outdoorOpts(): OutdoorClientOptions {
  return {
    provider: config.outdoorProvider,
    fallback: config.outdoorFallback,
    lat: config.outdoorLat,
    lon: config.outdoorLon,
    stubTempC: config.outdoorStubTempC,
    ttlMs: config.outdoorTtlMs,
  };
}

function cachePath(): string {
  return path.join(config.bridgeDataDir, "heatup", CACHE_FILE);
}

async function loadDiskCache(): Promise<void> {
  if (cacheLoaded) {
    return;
  }
  cacheLoaded = true;
  try {
    const raw = await fs.readFile(cachePath(), "utf8");
    const parsed = JSON.parse(raw) as OutdoorReading;
    if (
      typeof parsed?.tempC === "number" &&
      Number.isFinite(parsed.tempC) &&
      typeof parsed.source === "string"
    ) {
      lastReading = parsed;
    }
  } catch {
    // no cache yet
  }
}

async function saveDiskCache(reading: OutdoorReading): Promise<void> {
  try {
    const dir = path.dirname(cachePath());
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      cachePath(),
      `${JSON.stringify(reading, null, 2)}\n`,
      "utf8",
    );
  } catch (err) {
    console.warn(
      "[heatup/outdoor] cache write failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

function cacheFresh(reading: OutdoorReading | null, ttlMs: number): boolean {
  if (!reading?.fetchedAt) {
    return false;
  }
  const age = Date.now() - new Date(reading.fetchedAt).getTime();
  return age >= 0 && age < ttlMs;
}

async function fetchBrightSky(
  lat: number,
  lon: number,
  fetchImpl: typeof fetch,
): Promise<OutdoorReading> {
  const url = new URL("https://api.brightsky.dev/current_weather");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  const res = await fetchImpl(url.toString(), {
    headers: { Accept: "application/json", "User-Agent": "heizplan-heatup/0.1" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) {
    throw new Error(`brightsky_http_${res.status}`);
  }
  const body = (await res.json()) as {
    weather?: { temperature?: number | null; timestamp?: string };
  };
  const temp = body.weather?.temperature;
  if (typeof temp !== "number" || !Number.isFinite(temp)) {
    throw new Error("brightsky_missing_temperature");
  }
  return {
    tempC: temp,
    observedAt: body.weather?.timestamp ?? new Date().toISOString(),
    source: "brightsky",
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchOpenMeteo(
  lat: number,
  lon: number,
  fetchImpl: typeof fetch,
): Promise<OutdoorReading> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("current", "temperature_2m");
  const res = await fetchImpl(url.toString(), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) {
    throw new Error(`openmeteo_http_${res.status}`);
  }
  const body = (await res.json()) as {
    current?: { temperature_2m?: number; time?: string };
  };
  const temp = body.current?.temperature_2m;
  if (typeof temp !== "number" || !Number.isFinite(temp)) {
    throw new Error("openmeteo_missing_temperature");
  }
  return {
    tempC: temp,
    observedAt: body.current?.time
      ? new Date(body.current.time).toISOString()
      : new Date().toISOString(),
    source: "openmeteo",
    fetchedAt: new Date().toISOString(),
  };
}

function stubReading(tempC: number): OutdoorReading {
  const now = new Date().toISOString();
  return {
    tempC,
    observedAt: now,
    source: "stub",
    fetchedAt: now,
  };
}

async function fetchFromProvider(
  id: OutdoorProviderId,
  opts: OutdoorClientOptions,
  fetchImpl: typeof fetch,
): Promise<OutdoorReading> {
  if (id === "stub" || opts.forceStub) {
    return stubReading(opts.stubTempC);
  }
  if (id === "brightsky") {
    return fetchBrightSky(opts.lat, opts.lon, fetchImpl);
  }
  return fetchOpenMeteo(opts.lat, opts.lon, fetchImpl);
}

/**
 * Resolve current outdoor temperature.
 * Uses TTL cache; primary provider first; on failure try fallback once.
 */
export async function fetchOutdoorTemperature(
  overrides?: Partial<OutdoorClientOptions>,
): Promise<OutdoorReading> {
  const opts: OutdoorClientOptions = { ...outdoorOpts(), ...overrides };
  const ttlMs = opts.ttlMs ?? config.outdoorTtlMs;
  await loadDiskCache();

  if (
    !opts.forceRefresh &&
    !opts.fetchImpl &&
    cacheFresh(lastReading, ttlMs)
  ) {
    return lastReading as OutdoorReading;
  }

  const fetchImpl = opts.fetchImpl ?? fetch;

  try {
    const reading = await fetchFromProvider(opts.provider, opts, fetchImpl);
    lastReading = reading;
    if (!opts.fetchImpl) {
      await saveDiskCache(reading);
    }
    return reading;
  } catch (primaryErr) {
    const fallback = opts.fallback;
    if (!fallback || fallback === opts.provider) {
      if (opts.provider !== "stub") {
        console.warn(
          "[heatup/outdoor] primary failed:",
          primaryErr instanceof Error ? primaryErr.message : primaryErr,
        );
      }
      if (lastReading) {
        return lastReading;
      }
      throw primaryErr;
    }
    console.warn(
      `[heatup/outdoor] ${opts.provider} failed, trying ${fallback}:`,
      primaryErr instanceof Error ? primaryErr.message : primaryErr,
    );
    try {
      const reading = await fetchFromProvider(fallback, opts, fetchImpl);
      lastReading = reading;
      if (!opts.fetchImpl) {
        await saveDiskCache(reading);
      }
      return reading;
    } catch (fallbackErr) {
      if (lastReading) {
        console.warn(
          "[heatup/outdoor] fallback failed, using stale cache:",
          fallbackErr instanceof Error ? fallbackErr.message : fallbackErr,
        );
        return lastReading;
      }
      throw fallbackErr;
    }
  }
}

/** Best-effort outdoor for capture — returns null on total failure. */
export async function tryOutdoorTemperature(
  overrides?: Partial<OutdoorClientOptions>,
): Promise<OutdoorReading | null> {
  try {
    return await fetchOutdoorTemperature(overrides);
  } catch {
    await loadDiskCache();
    return lastReading;
  }
}
