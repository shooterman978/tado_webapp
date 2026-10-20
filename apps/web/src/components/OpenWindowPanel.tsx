/**
 * Open-window settings panel (dashboard drill-in).
 * @package @heizplan/web
 */

import { useEffect, useState } from "react";
import type {
  OpenWindowResumeMode,
  OpenWindowSettings,
  Zone,
} from "@heizplan/shared";
import { fetchOpenWindowSettings, saveOpenWindowSettings } from "../api";
import { PageChrome } from "./PageChrome";

export interface OpenWindowPanelProps {
  zones: Zone[];
  onBack: () => void;
  onHome?: () => void;
  onSettingsChange?: (ow: OpenWindowSettings) => void;
}

export function OpenWindowPanel({
  zones,
  onBack,
  onHome,
  onSettingsChange,
}: OpenWindowPanelProps) {
  const [ow, setOw] = useState<OpenWindowSettings | null>(null);
  const [owError, setOwError] = useState<string | null>(null);
  const [owBusy, setOwBusy] = useState(false);

  useEffect(() => {
    void fetchOpenWindowSettings()
      .then((saved) => {
        setOw(saved);
        onSettingsChange?.(saved);
      })
      .catch((err: unknown) => {
        setOwError(err instanceof Error ? err.message : "Einstellungen laden fehlgeschlagen");
      });
  }, [onSettingsChange]);

  async function patchOw(next: Partial<OpenWindowSettings>): Promise<void> {
    if (!ow) {
      return;
    }
    setOwBusy(true);
    setOwError(null);
    try {
      const saved = await saveOpenWindowSettings({ ...ow, ...next });
      setOw(saved);
      onSettingsChange?.(saved);
    } catch (err) {
      setOwError(err instanceof Error ? err.message : "Speichern fehlgeschlagen");
    } finally {
      setOwBusy(false);
    }
  }

  function setRoomAutoOff(zoneId: string, autoOff: boolean): void {
    if (!ow) {
      return;
    }
    void patchOw({
      rooms: {
        ...ow.rooms,
        [zoneId]: { ...ow.rooms[zoneId], autoOff },
      },
    });
  }

  function setResumeMode(resumeMode: OpenWindowResumeMode): void {
    void patchOw({ resumeMode });
  }

  return (
    <div className="dash-panel">
      <PageChrome current="Fenster" onBack={onBack} onHome={onHome} />

      <div className="settings-group settings-group--window">
        <div className="settings-explain" role="note">
          <strong>Was passiert?</strong>
          <span>
            Wenn ein Fenster offen ist, siehst du es am Raum. Optional schaltet die Heizung
            dort aus — und wieder ein, sobald das Fenster zu ist.
          </span>
        </div>

        <label className="settings-row settings-row--toggle">
          <span className="settings-row__circle" style={{ background: "#5dade2" }} aria-hidden="true">
            F
          </span>
          <span className="settings-row__label">
            Fenster erkennen
            <small className="settings-row__sub">Anzeige auf dem Dashboard und im Raum</small>
          </span>
          <input
            type="checkbox"
            checked={ow?.detectionEnabled !== false}
            disabled={!ow || owBusy}
            onChange={(e) => void patchOw({ detectionEnabled: e.target.checked })}
          />
        </label>

        <label
          className={
            ow?.detectionEnabled === false
              ? "settings-row settings-row--toggle is-muted"
              : "settings-row settings-row--toggle"
          }
        >
          <span className="settings-row__circle" style={{ background: "#1b5e54" }} aria-hidden="true">
            H
          </span>
          <span className="settings-row__label">
            Heizung automatisch ausschalten
            <small className="settings-row__sub">
              Nur in Räumen mit offenem Fenster — spart Energie
            </small>
          </span>
          <input
            type="checkbox"
            checked={ow?.globalAutoOff ?? false}
            disabled={!ow || owBusy || ow.detectionEnabled === false}
            onChange={(e) => void patchOw({ globalAutoOff: e.target.checked })}
          />
        </label>

        {ow && ow.detectionEnabled !== false && ow.globalAutoOff ? (
          <div className="settings-rooms">
            <p className="settings-rooms__label">In diesen Räumen</p>
            {zones.length === 0 ? (
              <p className="settings__hint settings__hint--inline">Noch keine Räume geladen.</p>
            ) : (
              zones.map((zone) => {
                const room = ow.rooms[zone.id];
                const effective =
                  typeof room?.autoOff === "boolean" ? room.autoOff : true;
                return (
                  <label key={zone.id} className="settings-row settings-row--toggle">
                    <span className="settings-row__icon" aria-hidden="true">
                      ·
                    </span>
                    <span className="settings-row__label">
                      {zone.name}
                      {zone.windowOpen ? (
                        <small className="settings-row__sub">gerade offen</small>
                      ) : null}
                    </span>
                    <input
                      type="checkbox"
                      checked={effective}
                      disabled={owBusy}
                      onChange={(e) => setRoomAutoOff(zone.id, e.target.checked)}
                    />
                  </label>
                );
              })
            )}
          </div>
        ) : null}

        <details className="settings-advanced">
          <summary>Erweitert</summary>
          <p className="settings-advanced__hint">
            Für Technik-Interessierte. Im Alltag reichen die Schalter oben.
          </p>
          <fieldset className="settings-resume" disabled={!ow || owBusy}>
            <legend className="settings-resume__legend">
              Wenn das Fenster wieder zu ist
            </legend>
            <label className="settings-resume__option">
              <input
                type="radio"
                name="resumeMode"
                checked={ow?.resumeMode !== "clear_overlay"}
                onChange={() => setResumeMode("restore_setpoint")}
              />
              <span>
                Frühere Temperatur wieder einstellen
                <small>Empfohlen — so warm wie vorher</small>
              </span>
            </label>
            <label className="settings-resume__option">
              <input
                type="radio"
                name="resumeMode"
                checked={ow?.resumeMode === "clear_overlay"}
                onChange={() => setResumeMode("clear_overlay")}
              />
              <span>
                Dem Zeitplan folgen
                <small>Heizung wie im normalen Tagesplan</small>
              </span>
            </label>
          </fieldset>
        </details>
      </div>

      {owError ? (
        <p className="error-state" role="alert">
          {owError}
        </p>
      ) : null}
    </div>
  );
}
