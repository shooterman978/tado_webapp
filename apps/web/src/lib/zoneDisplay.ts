/**
 * Presentation helpers for room tiles (friendly names + heat state).
 * @package @heizplan/web
 */

import type { Zone } from "@heizplan/shared";

/** Soft per-room atmosphere accent (not brand purple; hash-stable). */
const ROOM_PALETTES = [
  { from: "#ffe8d6", to: "#ffd4b8", accent: "#c45c26" },
  { from: "#e4f0ea", to: "#cfe4d8", accent: "#2f6b55" },
  { from: "#e8eef8", to: "#d4dff0", accent: "#3a5f8a" },
  { from: "#f3e9f0", to: "#e6d4e0", accent: "#7a4a6a" },
  { from: "#f0efe4", to: "#e2e0c8", accent: "#6b6a3a" },
  { from: "#e9f3f4", to: "#cfe6e8", accent: "#2f6f74" },
  { from: "#f8ebe6", to: "#efd5cb", accent: "#a85a45" },
  { from: "#eceaf6", to: "#d9d5eb", accent: "#5a5080" },
] as const;

export function roomPalette(name: string): (typeof ROOM_PALETTES)[number] {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return ROOM_PALETTES[hash % ROOM_PALETTES.length];
}

export type HeatMode = "heat" | "off" | "unknown";

/** Target heating mode from bridge mapping (overlayActive ≈ Heat). */
export function heatMode(zone: Zone): HeatMode {
  if (zone.targetTempC === null && !zone.overlayActive) {
    return "off";
  }
  return zone.overlayActive ? "heat" : "off";
}

export function heatModeLabel(zone: Zone): string {
  return heatMode(zone) === "heat" ? "Heizen" : "Aus";
}

/** True when the radiator/thermostat is actively delivering heat. */
export function isActivelyHeating(zone: Zone): boolean {
  return (zone.heatingPowerPercent ?? 0) > 0;
}

export function activityLabel(zone: Zone): string {
  if (isActivelyHeating(zone)) {
    return "Heizt";
  }
  if (heatMode(zone) === "heat") {
    return "Bereit";
  }
  return "Aus";
}

export function formatTemp(value: number | null): string {
  if (value === null) {
    return "—";
  }
  return value.toFixed(1);
}

export function deviceCountLabel(zone: Zone): string | null {
  const n = zone.deviceCount ?? zone.deviceIds?.length ?? 0;
  if (n <= 1) {
    return null;
  }
  return `${n} Geräte`;
}
