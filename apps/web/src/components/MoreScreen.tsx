/**
 * Mehr tab — extensions entry (calendar rules + stubs).
 * @package @heizplan/web
 */

import { ChevronIcon } from "./icons";

interface MoreScreenProps {
  onOpenCalendarRules?: () => void;
}

export function MoreScreen({ onOpenCalendarRules }: MoreScreenProps) {
  return (
    <div className="more">
      <h1 className="settings__title">Mehr</h1>

      <p className="settings__section-label">Funktionen</p>
      <div className="settings-group settings-group--feature">
        <button
          type="button"
          className="settings-row settings-row--button settings-row--feature"
          onClick={onOpenCalendarRules}
          aria-label="Kalenderregeln öffnen"
        >
          <span className="settings-row__circle" style={{ background: "#c0392b" }} aria-hidden="true">
            K
          </span>
          <span className="settings-row__label">
            Kalenderregeln
            <small className="settings-row__sub">
              iCloud-Events → Raum-Soll (über Zeitplan)
            </small>
          </span>
          <span className="settings-row__meta">Öffnen</span>
          <ChevronIcon className="settings-row__chev" />
        </button>
      </div>

      <p className="settings__section-label">Info</p>
      <div className="settings-group">
        <p className="more__body">
          Hilfe und weitere Erweiterungen folgen. Heizplan · lokaler Stack · kein TadoLocal.
        </p>
      </div>
    </div>
  );
}
