/**
 * Shared domain types for API, PWA and bridge adapter.
 * @package @heizplan/shared
 */

/** How a zone display name was resolved. */
export type ZoneNameSource = "cloud" | "map" | "hap" | "mock";

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
  /** Heating power hint 0–100, if available. */
  heatingPowerPercent: number | null;
  /** ISO timestamp of last bridge update. */
  updatedAt: string | null;
  /** HAP accessory aids controlled by this room tile (aggregated). */
  deviceIds?: string[];
  /** Number of thermostats folded into this room. */
  deviceCount?: number;
  /** Where the friendly name came from. */
  nameSource?: ZoneNameSource;
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
