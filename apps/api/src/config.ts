/**
 * Runtime configuration from environment.
 * Secrets must come from env / Docker secrets — never hardcoded.
 *
 * @package @heizplan/api
 */

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined || value === "") {
    return undefined;
  }
  return value;
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

type OutdoorProvider = "brightsky" | "openmeteo" | "stub";

function outdoorProvider(name: string, fallback: OutdoorProvider): OutdoorProvider {
  const raw = (process.env[name] ?? fallback).toLowerCase();
  if (raw === "brightsky" || raw === "openmeteo" || raw === "stub") {
    return raw;
  }
  return fallback;
}

export const config = {
  host: env("API_HOST", "0.0.0.0"),
  port: Number(env("API_PORT", "3080")),
  version: env("APP_VERSION", "0.1.0"),
  nodeEnv: env("NODE_ENV", "development"),
  /** Mock zones when unpaired — useful for UI work under WSL. Disabled once paired. */
  useMockZones: env("BRIDGE_USE_MOCK_ZONES", "true") === "true",
  bridgeDataDir: env("BRIDGE_DATA_DIR", "./data/bridge"),
  /** LAN IP of the Tado V3 Internet Bridge (preferred over mDNS under WSL). */
  bridgeIp: optionalEnv("TADO_BRIDGE_IP"),
  /**
   * HomeKit setup code XXX-XX-XXX — only used server-side for /api/bridge/pair.
   * Never log or return this value.
   */
  bridgePin: optionalEnv("TADO_BRIDGE_PIN"),
  bridgePort: Number(env("TADO_BRIDGE_PORT", "80")),
  /**
   * Soft daily cap for all Tado cloud HTTP calls (Europe/Berlin day).
   * Conservative default under the ~100 free-tier ballpark; overridable via env / API.
   */
  cloudDailyLimit: Number(env("CLOUD_DAILY_REQUEST_LIMIT", "80")),
  /**
   * Home cloud auto-sync interval (metadata + openWindow), hours.
   * Schedules are never auto-fetched on room enter — only via explicit sync.
   */
  cloudAutoSyncHours: Number(env("CLOUD_AUTO_SYNC_HOURS", "4")),
  /**
   * Outdoor temperature for heat-up learning.
   * Primary: Bright Sky (DWD) for Lünen; Open-Meteo only as fallback.
   * Never Tado Cloud.
   */
  outdoorProvider: outdoorProvider("OUTDOOR_PROVIDER", "brightsky"),
  outdoorFallback: outdoorProvider("OUTDOOR_FALLBACK", "openmeteo") as OutdoorProvider | null,
  outdoorLat: envNumber("OUTDOOR_LAT", 51.6167),
  outdoorLon: envNumber("OUTDOOR_LON", 7.5281),
  outdoorStubTempC: envNumber("OUTDOOR_STUB_TEMP_C", 8),
  /** Model 0 EMA α (math-playground style). */
  heatupEmaAlpha: envNumber("HEATUP_EMA_ALPHA", 0.3),
  /** Asymmetric bias minutes (Comfort-Start pattern: prefer early). */
  heatupOffsetMin: envNumber("HEATUP_OFFSET_MIN", 3),
  heatupManualPreheatMinutes: envNumber("HEATUP_MANUAL_PREHEAT_MINUTES", 30),
  heatupMinSamplesForUi: envNumber("HEATUP_MIN_SAMPLES_UI", 3),
  heatupMinSamplesForModel3: envNumber("HEATUP_MIN_SAMPLES_MODEL3", 7),
  /**
   * Extension points:
   * - DATABASE_URL → learning samples, sync audit (later)
   * - HA_URL / HA_TOKEN → Home Assistant sync (later)
   * - ICAL_URL / ICAL_USER / ICAL_APP_PASSWORD → optional CalDAV bootstrap
   *   (preferred: Settings UI → calendar-credentials.json in volume)
   */
  /** Background calendar evaluate interval (ms). 0 = disabled. */
  calendarPollMs: Number(env("CALENDAR_POLL_MS", "60000")),
} as const;
