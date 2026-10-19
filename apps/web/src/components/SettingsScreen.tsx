/**
 * Settings shell — grouped lists from screenshots 03/04.
 * @package @heizplan/web
 */

import type { ReactNode } from "react";
import type { HealthStatus, ZonesResponse } from "@heizplan/shared";
import { ChevronIcon } from "./icons";

interface SettingsScreenProps {
  health: HealthStatus | null;
  zones: ZonesResponse | null;
  showHumidity: boolean;
  onShowHumidityChange: (value: boolean) => void;
}

interface RowProps {
  label: string;
  glyph: string;
  circle?: string;
  trailing?: ReactNode;
  muted?: boolean;
}

function Row({ label, glyph, circle, trailing, muted }: RowProps) {
  return (
    <div className={muted ? "settings-row is-muted" : "settings-row"}>
      {circle ? (
        <span className="settings-row__circle" style={{ background: circle }} aria-hidden="true">
          {glyph}
        </span>
      ) : (
        <span className="settings-row__icon" aria-hidden="true">
          {glyph}
        </span>
      )}
      <span className="settings-row__label">{label}</span>
      {trailing ?? <ChevronIcon className="settings-row__chev" />}
    </div>
  );
}

export function SettingsScreen({
  health,
  zones,
  showHumidity,
  onShowHumidityChange,
}: SettingsScreenProps) {
  return (
    <div className="settings">
      <h1 className="settings__title">Einstellungen</h1>

      <p className="settings__section-label">Zuhause</p>
      <div className="settings-group">
        <Row label="Räume & Geräte" glyph="R" />
        <Row
          label="Bridge & Pairing"
          glyph="B"
          trailing={
            <span className="settings-row__meta">
              {health?.bridge.paired ? "Gepaart" : health?.bridge.state ?? "—"}
            </span>
          }
        />
        <Row
          label="Raumnamen"
          glyph="N"
          trailing={
            <span className="settings-row__meta">{zones?.naming?.source ?? "none"}</span>
          }
        />
        <Row label="Personen" glyph="P" muted />
      </div>

      <p className="settings__section-label">Skills</p>
      <div className="settings-group">
        <Row label="Auto-Assist" glyph="A" circle="#1b5e54" muted />
        <Row label="Geofencing" glyph="G" circle="#2f6fed" muted />
        <Row label="Energy IQ" glyph="E" circle="#7cb342" muted />
        <Row label="Fenster-Offen-Erkennung" glyph="F" circle="#5dade2" muted />
        <Row label="Intelligenter Zeitplan" glyph="Z" circle="#e67e22" muted />
        <Row label="Raumluft-Komfort" glyph="L" circle="#1abc9c" muted />
      </div>

      <p className="settings__section-label">Darstellung</p>
      <div className="settings-group">
        <label className="settings-row settings-row--toggle">
          <span className="settings-row__icon" aria-hidden="true">
            D
          </span>
          <span className="settings-row__label">Luftfeuchtigkeit anzeigen</span>
          <input
            type="checkbox"
            checked={showHumidity}
            onChange={(e) => onShowHumidityChange(e.target.checked)}
          />
        </label>
      </div>

      <p className="settings__hint">
        Skills ohne Backend sind sichtbar aber inaktiv. Steuerung lokal (HomeKit). Kein
        Kalender/Learning. Produktname: Heizplan.
      </p>
    </div>
  );
}
