/**
 * Room / zone list with optional live setpoint controls.
 * @package @heizplan/web
 */

import { useState } from "react";
import type { Zone } from "@heizplan/shared";
import { setZoneTemperature } from "../api";
import {
  activityLabel,
  displayZoneName,
  formatTemp,
  heatMode,
  heatModeLabel,
  isActivelyHeating,
} from "../lib/zoneDisplay";

interface ZoneListProps {
  zones: Zone[];
  /** When true, temperature controls talk to the live bridge. */
  interactive?: boolean;
  /** Optimistic local update before API round-trip. */
  onOptimisticTarget?: (zoneId: string, tempC: number) => void;
  /** Revert optimistic change after failure. */
  onRevertTarget?: (zoneId: string, tempC: number | null) => void;
  /** Soft refresh after successful write. */
  onChanged?: () => void;
}

export function ZoneList({
  zones,
  interactive = false,
  onOptimisticTarget,
  onRevertTarget,
  onChanged,
}: ZoneListProps) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);

  if (zones.length === 0) {
    return (
      <div className="empty-state" role="status">
        Noch keine Räume. Nach dem Bridge-Pairing erscheinen Zonen hier.
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
      <ul className="zone-list" aria-label="Räume">
        {zones.map((zone) => {
          const power = zone.heatingPowerPercent ?? 0;
          const busy = pendingId === zone.id;
          const heating = isActivelyHeating(zone);
          const mode = heatMode(zone);
          const shortName = displayZoneName(zone.name);

          return (
            <li
              key={zone.id}
              className={[
                "zone-row",
                heating ? "zone-row--heating" : "",
                flashId === zone.id ? "zone-row--flash" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <div className="zone-info">
                <h2 className="zone-name" title={zone.name}>
                  {shortName}
                </h2>
                <p className="zone-meta">
                  <span
                    className={`mode-pill mode-pill--${mode}`}
                    title={zone.name}
                  >
                    {heatModeLabel(zone)}
                  </span>
                  <span className="zone-meta__sep" aria-hidden="true">
                    ·
                  </span>
                  <span>{activityLabel(zone)}</span>
                  {zone.heatingPowerPercent !== null && zone.heatingPowerPercent > 0 ? (
                    <span> · {zone.heatingPowerPercent}%</span>
                  ) : null}
                </p>
              </div>
              <div className="zone-temps">
                <div className="temp-current">
                  {formatTemp(zone.currentTempC)}
                  <small> °C</small>
                </div>
                <div className="temp-target">
                  Soll {formatTemp(zone.targetTempC)} °C
                </div>
                {interactive && zone.targetTempC !== null ? (
                  <div className="temp-controls">
                    <button
                      type="button"
                      className="temp-btn"
                      disabled={busy}
                      aria-label={`${shortName}: Soll −0,5 °C`}
                      onClick={() => void nudge(zone, -0.5)}
                    >
                      −0,5
                    </button>
                    <button
                      type="button"
                      className="temp-btn"
                      disabled={busy}
                      aria-label={`${shortName}: Soll +0,5 °C`}
                      onClick={() => void nudge(zone, 0.5)}
                    >
                      +0,5
                    </button>
                  </div>
                ) : null}
              </div>
              <div
                className="heat-bar"
                role="presentation"
                aria-hidden="true"
              >
                <span
                  style={{
                    width: `${Math.min(100, Math.max(heating ? 12 : 0, power))}%`,
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
