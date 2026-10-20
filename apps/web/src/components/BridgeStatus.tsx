/**
 * Compact connection chip (dark home shell).
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
  /** Optional drill-in to Bridge panel (dashboard unify). */
  onOpenDetail?: () => void;
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
  mock: "Fixtures",
  loading: "Lädt …",
};

export function BridgeStatus({
  health,
  zones,
  offline,
  lastUpdated,
  refreshing,
  onRefresh,
  onOpenDetail,
}: BridgeStatusProps) {
  const kind = classify(health, zones, offline);
  return (
    <section className={`bridge-status bridge-status--${kind}`} aria-live="polite">
      <span className="bridge-status__dot" aria-hidden="true" />
      {onOpenDetail ? (
        <button
          type="button"
          className="bridge-status__title bridge-status__title--btn"
          onClick={onOpenDetail}
        >
          {LABELS[kind]}
          {lastUpdated
            ? ` · ${lastUpdated.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`
            : ""}
        </button>
      ) : (
        <p className="bridge-status__title">
          {LABELS[kind]}
          {lastUpdated
            ? ` · ${lastUpdated.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`
            : ""}
        </p>
      )}
      <button
        type="button"
        className="bridge-status__refresh"
        onClick={onRefresh}
        disabled={refreshing}
      >
        {refreshing ? "…" : "Aktualisieren"}
      </button>
    </section>
  );
}
