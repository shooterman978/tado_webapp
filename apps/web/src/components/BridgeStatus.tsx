/**
 * Bridge / API connection strip for the room overview.
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

const LABELS: Record<ConnectionKind, { title: string; hint: string }> = {
  live: {
    title: "Verbunden",
    hint: "Live-Zonen von der HomeKit-Bridge",
  },
  offline: {
    title: "Offline",
    hint: "API nicht erreichbar — Netzwerk prüfen",
  },
  unpaired: {
    title: "Pairing nötig",
    hint: "TADO_BRIDGE_IP + PIN in .env, dann /api/bridge/pair",
  },
  error: {
    title: "Bridge-Fehler",
    hint: "LAN und Pairing-Volume prüfen",
  },
  mock: {
    title: "Mock-Daten",
    hint: "Bridge ungepaart — Demo-Räume",
  },
  loading: {
    title: "Lädt …",
    hint: "Verbindung zur API",
  },
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
  const copy = LABELS[kind];
  const detail = offline
    ? copy.hint
    : (health?.bridge.message ?? copy.hint);

  return (
    <section
      className={`bridge-status bridge-status--${kind}`}
      aria-live="polite"
      aria-label="Bridge-Status"
    >
      <div className="bridge-status__main">
        <span className="bridge-status__dot" aria-hidden="true" />
        <div>
          <p className="bridge-status__title">{copy.title}</p>
          <p className="bridge-status__hint">{detail}</p>
        </div>
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
