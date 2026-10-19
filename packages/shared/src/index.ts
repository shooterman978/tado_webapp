/**
 * Shared domain types for API, PWA and bridge adapter.
 * @package @heizplan/shared
 */

/** Heating zone as seen by the PWA / API (mapped from bridge). */
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

export interface ZonesResponse {
  zones: Zone[];
  source: "mock" | "bridge" | "empty";
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
