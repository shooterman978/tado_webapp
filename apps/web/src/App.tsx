/**
 * Heizplan PWA shell — live room overview when the bridge is paired.
 * @package @heizplan/web
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { HealthStatus, ZonesResponse } from "@heizplan/shared";
import { fetchHealth, fetchZones } from "./api";
import { BridgeStatus } from "./components/BridgeStatus";
import { ZoneList } from "./components/ZoneList";

/** Poll cadence while the tab is visible (live bridge or unpaired). */
const POLL_MS = 15_000;

export function App() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [zones, setZones] = useState<ZonesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const visibleRef = useRef(
    typeof document !== "undefined"
      ? document.visibilityState !== "hidden"
      : true,
  );

  const load = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) {
      setRefreshing(true);
    }
    try {
      const [h, z] = await Promise.all([fetchHealth(), fetchZones()]);
      setHealth(h);
      setZones(z);
      setError(null);
      setOffline(false);
      setLastUpdated(new Date());
    } catch (err) {
      setOffline(true);
      setError(err instanceof Error ? err.message : "Laden fehlgeschlagen");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();

    const onVisibility = (): void => {
      visibleRef.current = document.visibilityState !== "hidden";
      if (visibleRef.current) {
        void load({ quiet: true });
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    const id = window.setInterval(() => {
      if (!visibleRef.current) {
        return;
      }
      void load({ quiet: true });
    }, POLL_MS);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(id);
    };
  }, [load]);

  const live = Boolean(
    zones?.source === "bridge" && health?.bridge.paired && !offline,
  );

  function patchTarget(zoneId: string, tempC: number | null): void {
    setZones((prev) => {
      if (!prev) {
        return prev;
      }
      return {
        ...prev,
        zones: prev.zones.map((z) =>
          z.id === zoneId
            ? {
                ...z,
                targetTempC: tempC,
                updatedAt: new Date().toISOString(),
              }
            : z,
        ),
      };
    });
  }

  return (
    <div className="app-shell">
      <header className="brand-bar">
        <h1 className="brand">
          Heiz<span>plan</span>
        </h1>
        <div className="brand-meta">
          <span>Lokal</span>
          <span className="brand-meta__dot" aria-hidden="true" />
          <span>V3</span>
        </div>
      </header>

      <p className="hero-line">Räume</p>
      <p className="hero-sub">
        Ist und Soll direkt von der eigenen Bridge — ohne Cloud-Quota im Alltag.
      </p>

      <BridgeStatus
        health={health}
        zones={zones}
        offline={offline}
        lastUpdated={lastUpdated}
        refreshing={refreshing}
        onRefresh={() => void load()}
      />

      {error && offline ? (
        <div className="error-state" role="alert">
          {error}. API unter /api erreichbar?
        </div>
      ) : null}

      {!offline && health && !health.bridge.paired ? (
        <div className="callout callout--pairing" role="status">
          <strong>Bridge nicht gepaart.</strong> Solange kein Pairing besteht,
          zeigt die Übersicht keine Live-Temperaturen
          {zones?.source === "mock" ? " (nur Mock)" : ""}. Pairing: Env setzen,
          dann <code>POST /api/bridge/pair</code>.
        </div>
      ) : null}

      {!offline ? (
        <ZoneList
          zones={zones?.zones ?? []}
          interactive={live}
          onOptimisticTarget={(id, temp) => patchTarget(id, temp)}
          onRevertTarget={(id, temp) => patchTarget(id, temp)}
          onChanged={() => void load({ quiet: true })}
        />
      ) : null}

      <footer className="footer-note">
        {live
          ? "Live über HomeKit. Tippe ±0,5 °C — Änderungen gehen sofort an die Bridge."
          : offline
            ? "Keine Verbindung zur API."
            : "Mock oder ungepaart — nach Pairing erscheinen Live-Zonen und Soll-Steuerung."}
      </footer>
    </div>
  );
}
