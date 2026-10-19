/**
 * 2-column room tiles — layout from screenshot 05.
 * @package @heizplan/web
 */

import type { Zone } from "@heizplan/shared";
import {
  formatTemp,
  heatMode,
  splitTemp,
  tilePalette,
} from "../lib/zoneDisplay";
import { DropIcon, HandIcon } from "./icons";

interface RoomGridProps {
  zones: Zone[];
  showHumidity: boolean;
  onSelect: (zoneId: string) => void;
}

export function RoomGrid({ zones, showHumidity, onSelect }: RoomGridProps) {
  if (zones.length === 0) {
    return (
      <div className="empty-state" role="status">
        Noch keine Räume.
      </div>
    );
  }

  return (
    <ul className="room-grid" aria-label="Räume">
      {zones.map((zone, index) => {
        const palette = tilePalette(zone);
        const off = heatMode(zone) === "off";
        const manual = zone.overlayActive;
        const { whole, frac } = splitTemp(zone.currentTempC);
        const style = {
          ["--tile-from" as string]: palette.from,
          ["--tile-to" as string]: palette.to,
          ["--tile-ink" as string]: palette.ink,
          ["--tile-muted" as string]: palette.muted,
          ["--tile-accent" as string]: palette.accent,
          animationDelay: `${0.05 + index * 0.04}s`,
        };

        return (
          <li key={zone.id} style={style}>
            <button
              type="button"
              className={[
                "room-tile",
                `room-tile--${palette.kind}`,
                manual ? "room-tile--manual" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => onSelect(zone.id)}
              aria-label={`${zone.name}, Ist ${formatTemp(zone.currentTempC)} Grad`}
            >
              {showHumidity && zone.humidityPercent != null ? (
                <span className="room-tile__humidity">
                  <DropIcon />
                  {zone.humidityPercent}%
                </span>
              ) : null}

              <p className="room-tile__current" aria-hidden="true">
                <span className="room-tile__whole">{whole}</span>
                {frac != null ? (
                  <span className="room-tile__frac">
                    <span className="room-tile__dot">.</span>
                    {frac}
                    <span className="room-tile__deg">°</span>
                  </span>
                ) : (
                  <span className="room-tile__deg">°</span>
                )}
              </p>

              <div className="room-tile__foot">
                <h2 className="room-tile__name">{zone.name}</h2>
                <p className="room-tile__set">
                  {manual ? <HandIcon className="room-tile__hand" /> : null}
                  {off ? (
                    <span>Aus</span>
                  ) : (
                    <span>Eingestellt auf {formatTemp(zone.targetTempC)}°</span>
                  )}
                </p>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
