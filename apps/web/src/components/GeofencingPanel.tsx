/**
 * Home/Away presence detail (dashboard drill-in).
 * @package @heizplan/web
 */

import { useEffect, useState } from "react";
import type { CloudQuotaStatus, HomePresenceStatus } from "@heizplan/shared";
import { ApiError, refreshHomePresence } from "../api";
import { PageChrome } from "./PageChrome";

export interface GeofencingPanelProps {
  presence?: HomePresenceStatus | null;
  onPresenceChange?: (presence: HomePresenceStatus) => void;
  onQuotaChange?: (quota: CloudQuotaStatus) => void;
  onZonesRefresh?: () => void;
  onBack: () => void;
  onHome?: () => void;
}

function modeLabel(p: HomePresenceStatus | null | undefined): string {
  if (!p || p.mode === "unknown") {
    return "Unbekannt";
  }
  return p.mode === "home" ? "Zuhause" : "Unterwegs";
}

export function GeofencingPanel({
  presence = null,
  onPresenceChange,
  onQuotaChange,
  onZonesRefresh,
  onBack,
  onHome,
}: GeofencingPanelProps) {
  const [local, setLocal] = useState<HomePresenceStatus | null>(presence);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLocal(presence);
  }, [presence]);

  async function refresh(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await refreshHomePresence(true);
      setLocal(res.presence);
      onPresenceChange?.(res.presence);
      onQuotaChange?.(res.quota);
      onZonesRefresh?.();
    } catch (err) {
      if (err instanceof ApiError && err.quota) {
        onQuotaChange?.(err.quota);
      }
      setError(
        err instanceof Error ? err.message : "Home/Away aktualisieren fehlgeschlagen",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dash-panel">
      <PageChrome current="Geofencing" onBack={onBack} onHome={onHome} />

      <div className="settings-explain" role="note">
        <strong>Home / Away</strong>
        <span>
          Kommt von der Tado-Cloud (Geofencing / Auto-Assist). Kalenderregeln können „nur zu
          Hause“, „nur weg“ oder „immer“ greifen.
        </span>
      </div>

      <div className="settings-group">
        <div className="settings-row">
          <span className="settings-row__circle" style={{ background: "#2f6fed" }} aria-hidden="true">
            G
          </span>
          <span className="settings-row__label">
            Aktueller Status
            <small className="settings-row__sub">
              {local?.message ?? "Noch nicht geladen"}
            </small>
          </span>
          <span className="settings-row__meta">{modeLabel(local)}</span>
        </div>
        {local?.presenceLocked ? (
          <p className="settings__hint settings__hint--inline">
            Manuell in der Tado-App gesetzt (gesperrt).
          </p>
        ) : null}
        {local?.stale ? (
          <p className="settings__hint settings__hint--inline">
            Stand älter — bitte aktualisieren (zählt 1 Cloud-Call).
          </p>
        ) : null}
        <button
          type="button"
          className="settings-row settings-row--button settings-row--feature"
          onClick={() => void refresh()}
          disabled={busy}
          aria-label="Home Away Status aktualisieren"
        >
          <span className="settings-row__circle" style={{ background: "#2f6fed" }} aria-hidden="true">
            ↻
          </span>
          <span className="settings-row__label">
            Status aktualisieren
            <small className="settings-row__sub">1 Quota · Cache danach 15 Min frisch</small>
          </span>
          <span className="settings-row__meta">{busy ? "…" : "Jetzt"}</span>
        </button>
      </div>

      {error ? (
        <p className="error-state" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
