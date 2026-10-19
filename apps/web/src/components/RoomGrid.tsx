/**
 * Room tile grid — Tado-app-like hierarchy (Ist/Soll, heat, per-room control).
 * @package @heizplan/web
 */

import { useState } from "react";
import type { Zone } from "@heizplan/shared";
import { setZoneTemperature } from "../api";
import {
  activityLabel,
  deviceCountLabel,
  formatTemp,
  heatMode,
  heatModeLabel,
  isActivelyHeating,
  roomPalette,
} from "../lib/zoneDisplay";

interface RoomGridProps {
  zones: Zone[];
  /** When true, temperature controls talk to the live bridge. */
  interactive?: boolean;
  onOptimisticTarget?: (zoneId: string, tempC: number) => void;
  onRevertTarget?: (zoneId: string, tempC: number | null) => void;
  onChanged?: () => void;
}

export function RoomGrid({
  zones,
  interactive = false,
  onOptimisticTarget,
  onRevertTarget,
  onChanged,
}: RoomGridProps) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);

  if (zones.length === 0) {
    return (
      <div className="empty-state" role="status">
        Noch keine Räume. Nach dem Bridge-Pairing und der Namens-Sync erscheinen
        hier Raumkacheln.
      </div>
    );
  }

  async function nudge(zone: Zone, delta: number): Promise<void> {
    if (!interactive || zone.targetTempC === null) {
      return;
    }
    const previous = zone.targetTempC;
    const next = Math.round((previous + delta) * 10) / 10;
    if (next < 5 || next > 30) {
      setError("Solltemperatur nur zwischen 5 und 30 °C.");
      return;
    }

    setPendingId(zone.id);
    setError(null);
    onOptimisticTarget?.(zone.id, next);
    setFlashId(zone.id);

    try {
      await setZoneTemperature(zone.id, next);
      onChanged?.();
    } catch (err) {
      onRevertTarget?.(zone.id, previous);
      setError(err instanceof Error ? err.message : "Solltemperatur fehlgeschlagen");
    } finally {
      setPendingId(null);
      window.setTimeout(() => {
        setFlashId((cur) => (cur === zone.id ? null : cur));
      }, 600);
    }
  }

  return (
    <div>
      {error ? (
        <div className="error-state" role="alert">
          {error}
        </div>
      ) : null}
      <ul className="room-grid" aria-label="Räume">
        {zones.map((zone, index) => {
          const palette = roomPalette(zone.name);
          const heating = isActivelyHeating(zone);
          const mode = heatMode(zone);
          const busy = pendingId === zone.id;
          const devices = deviceCountLabel(zone);
          const style = {
            ["--room-from" as string]: palette.from,
            ["--room-to" as string]: palette.to,
            ["--room-accent" as string]: palette.accent,
            animationDelay: `${0.08 + index * 0.05}s`,
          };

          return (
            <li
              key={zone.id}
              className={[
                "room-tile",
                heating ? "room-tile--heating" : "",
                flashId === zone.id ? "room-tile--flash" : "",
                mode === "off" ? "room-tile--off" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={style}
            >
              <header className="room-tile__head">
                <h2 className="room-tile__name">{zone.name}</h2>
                <p className="room-tile__status">
                  <span className={`room-tile__mode room-tile__mode--${mode}`}>
                    {heatModeLabel(zone)}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{activityLabel(zone)}</span>
                  {devices ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{devices}</span>
                    </>
                  ) : null}
                </p>
              </header>

              <div className="room-tile__temps">
                <p className="room-tile__current" aria-label={`Ist ${formatTemp(zone.currentTempC)} Grad`}>
                  <span className="room-tile__current-value">
                    {formatTemp(zone.currentTempC)}
                  </span>
                  <span className="room-tile__unit">°C</span>
                </p>
                <p
                  className="room-tile__target"
                  aria-label={`Soll ${formatTemp(zone.targetTempC)} Grad`}
                >
                  Soll {formatTemp(zone.targetTempC)} °C
                </p>
              </div>

              {interactive && zone.targetTempC !== null ? (
                <div className="room-tile__controls">
                  <button
                    type="button"
                    className="room-tile__btn"
                    disabled={busy}
                    aria-label={`${zone.name}: Soll −0,5 °C`}
                    onClick={() => void nudge(zone, -0.5)}
                  >
                    −
                  </button>
                  <span className="room-tile__setpoint" aria-hidden="true">
                    {formatTemp(zone.targetTempC)}
                  </span>
                  <button
                    type="button"
                    className="room-tile__btn"
                    disabled={busy}
                    aria-label={`${zone.name}: Soll +0,5 °C`}
                    onClick={() => void nudge(zone, 0.5)}
                  >
                    +
                  </button>
                </div>
              ) : null}

              <div className="room-tile__glow" aria-hidden="true" />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
