import { useState } from "react";
import type { Zone } from "@heizplan/shared";
import { setZoneTemperature } from "../api";

interface ZoneListProps {
  zones: Zone[];
  /** When true, temperature controls talk to the live bridge. */
  interactive?: boolean;
  onChanged?: () => void;
}

function formatTemp(value: number | null): string {
  if (value === null) {
    return "—";
  }
  return value.toFixed(1);
}

export function ZoneList({ zones, interactive = false, onChanged }: ZoneListProps) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    const next = Math.round((zone.targetTempC + delta) * 10) / 10;
    setPendingId(zone.id);
    setError(null);
    try {
      await setZoneTemperature(zone.id, next);
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Solltemperatur fehlgeschlagen");
    } finally {
      setPendingId(null);
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
          return (
            <li key={zone.id} className="zone-row">
              <div>
                <h2 className="zone-name">{zone.name}</h2>
                <p className="zone-meta">
                  {zone.overlayActive ? "Manuell aktiv" : "Zeitplan / Idle"}
                  {zone.heatingPowerPercent !== null
                    ? ` · ${zone.heatingPowerPercent}% Leistung`
                    : null}
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
                      aria-label={`${zone.name}: Soll −0,5 °C`}
                      onClick={() => void nudge(zone, -0.5)}
                    >
                      −0,5
                    </button>
                    <button
                      type="button"
                      className="temp-btn"
                      disabled={busy}
                      aria-label={`${zone.name}: Soll +0,5 °C`}
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
                <span style={{ width: `${Math.min(100, Math.max(0, power))}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
