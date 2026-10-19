/**
 * Presentation helpers for live bridge zones (HAP device names → UI).
 * @package @heizplan/web
 */

import type { Zone } from "@heizplan/shared";

/** Shorten verbose HAP accessory names for the room list. */
export function displayZoneName(raw: string): string {
  const serial = raw.match(/\b([A-Z]{2}\d{8,})\b/);
  if (serial) {
    const kind = /radiator/i.test(raw) ? "Radiator" : "Thermostat";
    return `${kind} · ${serial[1].slice(-4)}`;
  }
  return raw.replace(/^tado\s+/i, "").trim() || raw;
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
