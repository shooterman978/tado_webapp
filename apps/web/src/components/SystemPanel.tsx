/**
 * System hub — Cloud, Bridge, display, protocol (not on dashboard hero).
 * @package @heizplan/web
 */

import type { CloudQuotaStatus, HealthStatus, ZonesResponse } from "@heizplan/shared";
import {
  BridgeIcon,
  ChevronIcon,
  CloudIcon,
  DisplayIcon,
  ProtocolIcon,
} from "./icons";
import { PageChrome } from "./PageChrome";

export interface SystemPanelProps {
  health: HealthStatus | null;
  zones: ZonesResponse | null;
  quota: CloudQuotaStatus | null;
  onOpenCloud: () => void;
  onOpenBridge: () => void;
  onOpenDisplay: () => void;
  onOpenProtocol: () => void;
  onBack: () => void;
  onHome?: () => void;
}

export function SystemPanel({
  health,
  zones,
  quota,
  onOpenCloud,
  onOpenBridge,
  onOpenDisplay,
  onOpenProtocol,
  onBack,
  onHome,
}: SystemPanelProps) {
  const bridgeMeta = health?.bridge.paired
    ? "Verbunden"
    : zones?.source === "mock"
      ? "Testdaten"
      : "Nicht verbunden";

  return (
    <div className="dash-panel">
      <PageChrome current="System" onBack={onBack} onHome={onHome} />

      <p className="settings__section-label">Verbindung &amp; Protokoll</p>
      <div className="settings-group">
        <button
          type="button"
          className="settings-row settings-row--button"
          onClick={onOpenCloud}
        >
          <span
            className="settings-row__circle settings-row__circle--icon"
            style={{ background: "#3a3a3c" }}
            aria-hidden="true"
          >
            <CloudIcon />
          </span>
          <span className="settings-row__label">
            Cloud &amp; Kontingent
            <small className="settings-row__sub">Namen, Tageslimit, Sync, Anfragen</small>
          </span>
          <span className="settings-row__meta">{quota ? `${quota.remaining}` : "—"}</span>
          <ChevronIcon className="settings-row__chev" />
        </button>
        <button
          type="button"
          className="settings-row settings-row--button"
          onClick={onOpenBridge}
        >
          <span
            className="settings-row__circle settings-row__circle--icon"
            style={{ background: "#2c2c2e" }}
            aria-hidden="true"
          >
            <BridgeIcon />
          </span>
          <span className="settings-row__label">
            Bridge
            <small className="settings-row__sub">Verbindung zur Heizung</small>
          </span>
          <span className="settings-row__meta">{bridgeMeta}</span>
          <ChevronIcon className="settings-row__chev" />
        </button>
        <button
          type="button"
          className="settings-row settings-row--button"
          onClick={onOpenDisplay}
        >
          <span
            className="settings-row__circle settings-row__circle--icon"
            style={{ background: "#2c2c2e" }}
            aria-hidden="true"
          >
            <DisplayIcon />
          </span>
          <span className="settings-row__label">
            Darstellung
            <small className="settings-row__sub">Luftfeuchtigkeit anzeigen</small>
          </span>
          <ChevronIcon className="settings-row__chev" />
        </button>
        <button
          type="button"
          className="settings-row settings-row--button"
          onClick={onOpenProtocol}
        >
          <span
            className="settings-row__circle settings-row__circle--icon"
            style={{ background: "#3d3a66" }}
            aria-hidden="true"
          >
            <ProtocolIcon />
          </span>
          <span className="settings-row__label">
            Protokoll
            <small className="settings-row__sub">Was Automationen gemacht haben</small>
          </span>
          <ChevronIcon className="settings-row__chev" />
        </button>
      </div>
    </div>
  );
}
