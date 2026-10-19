/**
 * Compact bridge / API connection chip for the room overview.
 * @package @heizplan/web
 */

import type { BridgePairingState, HealthStatus, ZonesResponse } from "@heizplan/shared";

export type ConnectionKind = "live" | "offline" | "unpaired" | "error" | "mock" | "loading";

interface BridgeStatusProps {
  health: HealthStatus | null;
  zones: ZonesResponse | null;
  offline: boolean;
  lastUpdated: Date | null;
  refreshing: boolean;
  onRefresh: () => void;
}

function classify(
  health: HealthStatus | null,
  zones: ZonesResponse | null,
  offline: boolean,
): ConnectionKind {
  if (offline) {
    return "offline";
  }
  if (!health || !zones) {
    return "loading";
  }
  const state: BridgePairingState = health.bridge.state;
  if (state === "error") {
    return "error";
  }
  if (!health.bridge.paired || state === "unpaired" || state === "awaiting_pin") {
    return "unpaired";
  }
  if (zones.source === "mock") {
    return "mock";
  }
  if (health.bridge.paired && zones.source === "bridge") {
    return "live";
  }
  if (health.bridge.paired) {
    return "live";
  }
  return "unpaired";
}

const LABELS: Record<ConnectionKind, string> = {
  live: "Bridge verbunden",
  offline: "Offline",
  unpaired: "Pairing nötig",
  error: "Bridge-Fehler",
  mock: "Mock-Daten",
  loading: "Lädt …",
};

function formatClock(d: Date | null): string {
  if (!d) {
    return "—";
  }
  return d.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function BridgeStatus({
  health,
  zones,
  offline,
  lastUpdated,
  refreshing,
  onRefresh,
}: BridgeStatusProps) {
  const kind = classify(health, zones, offline);
  const title = LABELS[kind];
  const namingHint =
    zones?.naming?.source === "cloud"
      ? " · Raumnamen Cloud"
      : zones?.naming?.source === "map"
        ? " · Raumnamen Map"
        : "";

  return (
    <section
      className={`bridge-status bridge-status--${kind}`}
      aria-live="polite"
      aria-label="Bridge-Status"
    >
      <div className="bridge-status__main">
        <span className="bridge-status__dot" aria-hidden="true" />
        <p className="bridge-status__title">
          {title}
          {kind === "live" ? namingHint : ""}
        </p>
      </div>
      <div className="bridge-status__meta">
        <span className="bridge-status__clock">
          Stand {formatClock(lastUpdated)}
        </span>
        <button
          type="button"
          className="bridge-status__refresh"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="Räume aktualisieren"
        >
          {refreshing ? "…" : "Aktualisieren"}
        </button>
      </div>
    </section>
  );
}
