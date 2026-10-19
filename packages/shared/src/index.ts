/**
 * Shared domain types for API, PWA and bridge adapter.
 * @package @heizplan/shared
 */

/** How a zone display name was resolved. */
export type ZoneNameSource = "cloud" | "map" | "hap" | "mock";

/** Where open-window state was resolved from. */
export type WindowOpenSource =
  | "hap"
  | "cloud"
  | "fixture"
  | "manual"
  | "none";

/** Resume strategy after local auto-off when the window closes. */
export type OpenWindowResumeMode = "restore_setpoint" | "clear_overlay";

/** Single thermostat / accessory folded into a room tile. */
export interface ZoneDevice {
  id: string;
  name: string;
  serialNo?: string | null;
  /** Low-battery hint from HAP, if known. */
  batteryLow?: boolean | null;
  currentTempC?: number | null;
  targetTempC?: number | null;
  /** Contact / open-window hint from this accessory, if known. */
  windowOpen?: boolean | null;
}

/** Heating zone / room as seen by the PWA / API. */
export interface Zone {
  id: string;
  name: string;
  /** Current temperature in °C, if known. */
  currentTempC: number | null;
  /** Target / setpoint temperature in °C, if heating. */
  targetTempC: number | null;
  /** Whether an overlay / manual setpoint is active. */
  overlayActive: boolean;
  /** ISO timestamp when a timed overlay ends (local tracker or fixture). */
  overlayEndsAt?: string | null;
  /** Heating power hint 0–100, if available. */
  heatingPowerPercent: number | null;
  /** Relative humidity 0–100, if a sensor is present. */
  humidityPercent?: number | null;
  /**
   * True when the room appears to follow schedule (no local manual overlay).
   * Not a full Smart Schedule — indicator only until a schedule source exists.
   */
  onSchedule?: boolean;
  /**
   * Open window detected for this room.
   * V3 Bridge HAP typically does not expose this — see windowSource.
   */
  windowOpen?: boolean;
  /** Provenance of {@link windowOpen}. */
  windowSource?: WindowOpenSource;
  /** ISO timestamp when open-window was first observed (local). */
  windowDetectedAt?: string | null;
  /** True while local auto-off holds heating off for an open window. */
  openWindowAutoOffActive?: boolean;
  /** ISO timestamp of last bridge update. */
  updatedAt: string | null;
  /** HAP accessory aids controlled by this room tile (aggregated). */
  deviceIds?: string[];
  /** Number of thermostats folded into this room. */
  deviceCount?: number;
  /** Devices belonging to this room (for detail screen). */
  devices?: ZoneDevice[];
  /** Where the friendly name came from. */
  nameSource?: ZoneNameSource;
}

/** Persisted open-window auto-off preferences (no paywall). */
export interface OpenWindowSettings {
  /** Default for all rooms unless overridden per room. */
  globalAutoOff: boolean;
  /**
   * After window closes and auto-off was applied:
   * - restore_setpoint: re-apply previous target + heat (default)
   * - clear_overlay: HAP clearOverlay / schedule approximation
   */
  resumeMode: OpenWindowResumeMode;
  /** Per-room override of globalAutoOff (room tile ids). */
  rooms: Record<string, { autoOff?: boolean }>;
}

export interface HapCapabilityAccessory {
  aid: number;
  name: string;
  services: Array<{
    type: string;
    name: string;
    characteristics: Array<{
      iid: number;
      type: string;
      name: string;
      format?: string;
      perms?: string[];
      value?: unknown;
    }>;
  }>;
  hasThermostat: boolean;
  hasContactSensor: boolean;
  hasHumidity: boolean;
  proprietaryServiceCount: number;
}

/** Diagnostic dump of what the paired V3 Bridge exposes over HAP. */
export interface HapCapabilitiesReport {
  generatedAt: string;
  paired: boolean;
  accessoryCount: number;
  thermostatCount: number;
  contactSensorCount: number;
  note: string;
  accessories: HapCapabilityAccessory[];
}

export interface HealthStatus {
  status: "ok" | "degraded";
  service: string;
  version: string;
  bridge: BridgeStatusSummary;
  timestamp: string;
}

export type BridgePairingState =
  | "unpaired"
  | "awaiting_pin"
  | "pairing"
  | "paired"
  | "error";

export interface BridgeStatusSummary {
  state: BridgePairingState;
  paired: boolean;
  message: string;
}

/** Naming metadata status for the room overview. */
export interface ZoneNamingInfo {
  /** Dominant / best naming source currently applied. */
  source: ZoneNameSource | "none";
  /** Last successful cloud metadata sync, if any. */
  syncedAt: string | null;
  /** Whether a Tado cloud refresh token is stored locally. */
  cloudLinked: boolean;
  /** Devices that still fall back to HAP serial labels. */
  unresolvedDeviceCount: number;
}

export interface ZonesResponse {
  zones: Zone[];
  source: "mock" | "bridge" | "empty";
  naming?: ZoneNamingInfo;
  /** Home/Away — not available via local HAP on V3 bridge. */
  presence?: {
    mode: "unknown" | "home" | "away";
    source: "none" | "cloud" | "manual";
    message: string;
  };
}

/** Cloud OAuth / metadata link status (names only — not live control). */
export interface CloudStatus {
  linked: boolean;
  homeId: number | null;
  homeName: string | null;
  syncedAt: string | null;
  deviceCount: number;
  zoneCount: number;
  message: string;
}

export interface CloudAuthStart {
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

export interface CloudAuthPollResult {
  status: "pending" | "linked" | "expired" | "error";
  message: string;
  cloud?: CloudStatus;
}

/** Extension hooks (Phase 1+) — typed placeholders only. */
export interface CalendarRuleHook {
  /** Keyword / title match against CalDAV events. */
  matchValue: string;
  roomId: string;
  targetTempC: number | null;
  mode: "heat" | "off" | "eco";
}

export interface HeatupLearningHook {
  roomId: string;
  sampleCount: number;
  estimatedPreheatMinutes: number | null;
}
