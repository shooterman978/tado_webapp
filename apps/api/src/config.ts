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
   * Extension points:
   * - DATABASE_URL → learning samples, sync audit (later)
   * - HA_URL / HA_TOKEN → Home Assistant sync (later)
   * - ICAL_URL / ICAL_USER / ICAL_APP_PASSWORD → optional CalDAV bootstrap
   *   (preferred: Settings UI → calendar-credentials.json in volume)
   */
  /** Background calendar evaluate interval (ms). 0 = disabled. */
  calendarPollMs: Number(env("CALENDAR_POLL_MS", "60000")),
} as const;
