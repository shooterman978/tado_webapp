import type { Zone } from "@heizplan/shared";

interface ZoneListProps {
  zones: Zone[];
}

function formatTemp(value: number | null): string {
  if (value === null) {
    return "—";
  }
  return value.toFixed(1);
}

export function ZoneList({ zones }: ZoneListProps) {
  if (zones.length === 0) {
    return (
      <div className="empty-state" role="status">
        Noch keine Räume. Nach dem Bridge-Pairing erscheinen Zonen hier.
      </div>
    );
  }

  return (
    <ul className="zone-list" aria-label="Räume">
      {zones.map((zone) => {
        const power = zone.heatingPowerPercent ?? 0;
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
  );
}
