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

export const config = {
  host: env("API_HOST", "0.0.0.0"),
  port: Number(env("API_PORT", "3080")),
  version: env("APP_VERSION", "0.1.0"),
  nodeEnv: env("NODE_ENV", "development"),
  /** Mock zones when unpaired — useful for UI work under WSL. */
  useMockZones: env("BRIDGE_USE_MOCK_ZONES", "true") === "true",
  bridgeDataDir: env("BRIDGE_DATA_DIR", "./data/bridge"),
  /**
   * Extension points (not wired in MVP scaffold):
   * - DATABASE_URL → rules, learning samples, sync audit
   * - HA_URL / HA_TOKEN → Home Assistant sync
   * - ICAL_* → CalDAV calendar sync
   */
} as const;
