/**
 * Display preferences (dashboard drill-in).
 * @package @heizplan/web
 */

import { PageChrome } from "./PageChrome";

export interface DisplayPanelProps {
  showHumidity: boolean;
  onShowHumidityChange: (value: boolean) => void;
  onBack: () => void;
  onHome?: () => void;
}

export function DisplayPanel({
  showHumidity,
  onShowHumidityChange,
  onBack,
  onHome,
}: DisplayPanelProps) {
  return (
    <div className="dash-panel">
      <PageChrome current="Darstellung" onBack={onBack} onHome={onHome} />

      <p className="settings__section-label">Anzeige</p>
      <div className="settings-group">
        <label className="settings-row settings-row--toggle">
          <span className="settings-row__icon" aria-hidden="true">
            D
          </span>
          <span className="settings-row__label">
            Luftfeuchtigkeit anzeigen
            <small className="settings-row__sub">Auf Raumkacheln und im Detail</small>
          </span>
          <input
            type="checkbox"
            checked={showHumidity}
            onChange={(e) => onShowHumidityChange(e.target.checked)}
          />
        </label>
      </div>
    </div>
  );
}
