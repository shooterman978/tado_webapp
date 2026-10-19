/**
 * Presentation helpers — colours/labels from Tado screenshot parity.
 * @package @heizplan/web
 */

import type { Zone } from "@heizplan/shared";

export type HeatMode = "heat" | "off" | "unknown";

export function heatMode(zone: Zone): HeatMode {
  if (zone.targetTempC === null && !zone.overlayActive) {
    return "off";
  }
  return "heat";
}

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

/** Split "20.4" → { whole: "20", frac: "4" } for tile typography. */
export function splitTemp(value: number | null): {
  whole: string;
  frac: string | null;
} {
  if (value === null) {
    return { whole: "—", frac: null };
  }
  const [whole, frac] = value.toFixed(1).split(".");
  return { whole, frac: frac ?? null };
}

/**
 * Dark tile gradients from screenshot 05:
 * warm/orange for higher setpoints, teal-green for eco (<19), grey OFF.
 */
export function tilePalette(zone: Zone): {
  from: string;
  to: string;
  accent: string;
  ink: string;
  muted: string;
  kind: "warm" | "eco" | "off";
} {
  if (heatMode(zone) === "off" || zone.targetTempC === null) {
    return {
      from: "#3a3a3c",
      to: "#2c2c2e",
      accent: "#8e8e93",
      ink: "#f2f2f7",
      muted: "#aeaeb2",
      kind: "off",
    };
  }

  const t = zone.targetTempC;
  if (t < 19) {
    // Deep teal / forest (Kinderzimmer, Küche, Schlafzimmer)
    return {
      from: "#1a4a3e",
      to: "#0f2f28",
      accent: "#5ec8a8",
      ink: "#f5fffb",
      muted: "#a8d4c6",
      kind: "eco",
    };
  }
  // Burnt orange / muddy gold (Wohnzimmer, Büro, Bad)
  return {
    from: "#8a5a18",
    to: "#5c3a0e",
    accent: "#ffc14d",
    ink: "#fff8ec",
    muted: "#e8c98a",
    kind: "warm",
  };
}

export function overlayDurationLabel(zone: Zone): string | null {
  if (!zone.overlayActive) {
    return null;
  }
  if (!zone.overlayEndsAt) {
    return "Bis du den Zeitplan fortsetzt";
  }
  const ms = Date.parse(zone.overlayEndsAt) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) {
    return "Bis du den Zeitplan fortsetzt";
  }
  const mins = Math.round(ms / 60_000);
  if (mins < 60) {
    return `Noch ${mins} Min`;
  }
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `Noch ${h} Std ${m} Min` : `Noch ${h} Std`;
}

/** Detail screen olive background from screenshot 01 — tinted by room kind. */
export function detailBackground(zone: Zone): string {
  const p = tilePalette(zone);
  if (p.kind === "eco") {
    return "#1a332c";
  }
  if (p.kind === "off") {
    return "#2a2a2c";
  }
  return "#423b19";
}
