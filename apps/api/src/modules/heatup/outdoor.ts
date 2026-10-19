/**
 * Outdoor temperature — Bright Sky (DWD) primary, Open-Meteo fallback, stub for tests.
 * Never uses Tado Cloud.
 *
 * @package @heizplan/api
 */

import type { OutdoorProviderId } from "@heizplan/shared";
import { config } from "../../config.js";

export interface OutdoorReading {
  tempC: number;
  observedAt: string;
  source: OutdoorProviderId;
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
}

let lastReading: OutdoorReading | null = null;

export function getLastOutdoorReading(): OutdoorReading | null {
  return lastReading;
}

export function resetOutdoorCache(): void {
  lastReading = null;
}

function outdoorOpts(): OutdoorClientOptions {
  return {
    provider: config.outdoorProvider,
    fallback: config.outdoorFallback,
    lat: config.outdoorLat,
    lon: config.outdoorLon,
    stubTempC: config.outdoorStubTempC,
  };
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
    headers: { Accept: "application/json" },
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
  };
}

function stubReading(tempC: number): OutdoorReading {
  return {
    tempC,
    observedAt: new Date().toISOString(),
    source: "stub",
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
 * Primary provider first; on failure try fallback once.
 */
export async function fetchOutdoorTemperature(
  overrides?: Partial<OutdoorClientOptions>,
): Promise<OutdoorReading> {
  const opts: OutdoorClientOptions = { ...outdoorOpts(), ...overrides };
  const fetchImpl = opts.fetchImpl ?? fetch;

  try {
    const reading = await fetchFromProvider(opts.provider, opts, fetchImpl);
    lastReading = reading;
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
      throw primaryErr;
    }
    console.warn(
      `[heatup/outdoor] ${opts.provider} failed, trying ${fallback}:`,
      primaryErr instanceof Error ? primaryErr.message : primaryErr,
    );
    const reading = await fetchFromProvider(fallback, opts, fetchImpl);
    lastReading = reading;
    return reading;
  }
}

/** Best-effort outdoor for capture — returns null on total failure (sample still stored). */
export async function tryOutdoorTemperature(
  overrides?: Partial<OutdoorClientOptions>,
): Promise<OutdoorReading | null> {
  try {
    return await fetchOutdoorTemperature(overrides);
  } catch {
    return lastReading;
  }
}
