/**
 * Bridge / pairing / naming overview (dashboard drill-in).
 * @package @heizplan/web
 */

import type { HealthStatus, ZonesResponse } from "@heizplan/shared";
import { PageChrome } from "./PageChrome";

export interface BridgePanelProps {
  health: HealthStatus | null;
  zones: ZonesResponse | null;
  onBack: () => void;
  onHome?: () => void;
  onOpenCloud?: () => void;
}

export function BridgePanel({
  health,
  zones,
  onBack,
  onHome,
  onOpenCloud,
}: BridgePanelProps) {
  return (
    <div className="dash-panel">
      <PageChrome current="Bridge" onBack={onBack} onHome={onHome} />

      <p className="settings__section-label">Verbindung</p>
      <div className="settings-group">
        <div className="settings-row">
          <span className="settings-row__icon" aria-hidden="true">
            B
          </span>
          <span className="settings-row__label">
            Bridge &amp; Pairing
            <small className="settings-row__sub">
              {health?.bridge.paired
                ? "Gepaart — Steuerung über HomeKit"
                : health?.bridge.state ?? "Noch nicht gepaart"}
            </small>
          </span>
          <span className="settings-row__meta">
            {health?.bridge.paired ? "Gepaart" : health?.bridge.state ?? "—"}
          </span>
        </div>
        <div className="settings-row">
          <span className="settings-row__icon" aria-hidden="true">
            N
          </span>
          <span className="settings-row__label">
            Raumnamen-Quelle
            <small className="settings-row__sub">
              Cloud-Namen sind klarer als reine HAP-IDs
            </small>
          </span>
          <span className="settings-row__meta">{zones?.naming?.source ?? "none"}</span>
        </div>
        {onOpenCloud ? (
          <button
            type="button"
            className="settings-row settings-row--button"
            onClick={onOpenCloud}
          >
            <span className="settings-row__icon" aria-hidden="true">
              C
            </span>
            <span className="settings-row__label">
              Cloud verknüpfen
              <small className="settings-row__sub">Für echte Raumnamen &amp; Quota</small>
            </span>
            <span className="settings-row__meta">Öffnen</span>
          </button>
        ) : null}
      </div>

      <p className="settings__hint">
        Pairing läuft über die API (POST /api/bridge/pair). Alltagstemperaturen bleiben in der
        Tado-App.
      </p>
    </div>
  );
}
