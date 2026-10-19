import { useEffect, useState } from "react";
import type { HealthStatus, ZonesResponse } from "@heizplan/shared";
import { fetchHealth, fetchZones } from "./api";
import { ZoneList } from "./components/ZoneList";

export function App() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [zones, setZones] = useState<ZonesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [h, z] = await Promise.all([fetchHealth(), fetchZones()]);
        if (cancelled) {
          return;
        }
        setHealth(h);
        setZones(z);
        setError(null);
      } catch (err) {
        if (cancelled) {
          return;
        }
        setError(err instanceof Error ? err.message : "Laden fehlgeschlagen");
      }
    }

    void load();
    const id = window.setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [tick]);

  const sourceLabel =
    zones?.source === "mock"
      ? "Mock-Daten"
      : zones?.source === "bridge"
        ? "Bridge (Live)"
        : "leer";

  const live = zones?.source === "bridge";

  return (
    <div className="app-shell">
      <header className="brand-bar">
        <h1 className="brand">
          Heiz<span>plan</span>
        </h1>
        <div className="brand-meta">Lokal · V3</div>
      </header>

      <p className="hero-line">Räume</p>
      <p className="hero-sub">
        Ist- und Solltemperaturen aus der eigenen Bridge-Schicht — ohne
        Cloud-Quota im Alltag.
      </p>

      <div className="status-strip" aria-live="polite">
        <span>
          API: <strong>{health?.status ?? "…"}</strong>
        </span>
        <span>
          Bridge: <strong>{health?.bridge.state ?? "…"}</strong>
        </span>
        <span>
          Quelle: <strong>{zones ? sourceLabel : "…"}</strong>
        </span>
      </div>

      {error ? (
        <div className="error-state" role="alert">
          {error}. API unter /api erreichbar?
        </div>
      ) : (
        <ZoneList
          zones={zones?.zones ?? []}
          interactive={live}
          onChanged={() => setTick((n) => n + 1)}
        />
      )}

      <footer className="footer-note">
        {live
          ? "Live-Zonen über HomeKit. Kalenderregeln, Learning und HA-Sync folgen."
          : "Mock oder ungepaart — Pairing: TADO_BRIDGE_IP + TADO_BRIDGE_PIN in .env, dann /api/bridge/pair."}
      </footer>
    </div>
  );
}
