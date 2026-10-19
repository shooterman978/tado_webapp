/**
 * Smart Schedule UI stub — layout from screenshot 02 (read-only).
 * @package @heizplan/web
 */

import type { Zone } from "@heizplan/shared";
import { BackIcon, ChevronIcon, ScheduleIcon } from "./icons";

interface ScheduleScreenProps {
  zone: Zone;
  onBack: () => void;
}

type Block = { start: number; end: number; tempC: number };

/** Demo blocks for visual parity until schedule data exists. */
function stubBlocks(zone: Zone): Block[] {
  const low = zone.targetTempC != null && zone.targetTempC < 19 ? zone.targetTempC : 18;
  const high = zone.targetTempC != null && zone.targetTempC >= 19 ? zone.targetTempC : 20;
  return [
    { start: 0, end: 6, tempC: low },
    { start: 6, end: 9, tempC: high },
    { start: 9, end: 17, tempC: low },
    { start: 17, end: 22, tempC: high },
    { start: 22, end: 24, tempC: low },
  ];
}

const DAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag"];

export function ScheduleScreen({ zone, onBack }: ScheduleScreenProps) {
  const blocks = stubBlocks(zone);

  return (
    <div className="schedule">
      <header className="schedule__bar">
        <button type="button" className="icon-btn-ghost" onClick={onBack} aria-label="Zurück">
          <BackIcon />
        </button>
        <h1>{zone.name}</h1>
        <ScheduleIcon className="schedule__bar-icon" />
      </header>

      <h2 className="schedule__heading">Intelligenter Zeitplan</h2>
      <p className="schedule__note">
        Read-only Stub — echte Blöcke folgen (Cloud-Spiegel oder lokale Engine).
      </p>

      <div className="schedule__toggle" role="group" aria-label="Home oder Away">
        <button type="button" className="is-active">
          Home
        </button>
        <button type="button">Away</button>
      </div>

      <button type="button" className="schedule__days-row">
        <span>Wochentage</span>
        <span className="schedule__days-meta">
          Mo, Di, Mi, … <ChevronIcon />
        </span>
      </button>

      <ul className="schedule__days">
        {DAYS.map((day) => (
          <li key={day} className="schedule__day-card">
            <header>
              <span>{day}</span>
              <span aria-hidden="true">▾</span>
            </header>
            <div className="schedule__bar-24" aria-hidden="true">
              {blocks.map((b) => (
                <span
                  key={`${day}-${b.start}`}
                  className={b.tempC >= 19 ? "is-warm" : "is-cool"}
                  style={{
                    flex: Math.max(0.5, b.end - b.start),
                  }}
                >
                  {b.tempC.toFixed(1)}°
                </span>
              ))}
            </div>
            <div className="schedule__axis">
              <span>0:00</span>
              <span>8:00</span>
              <span>16:00</span>
              <span>24:00</span>
            </div>
            <footer>
              <span className="schedule__stub-actions">Kopieren · Einfügen</span>
              <span className="schedule__add">Zeitblock hinzufügen</span>
            </footer>
          </li>
        ))}
      </ul>
    </div>
  );
}
