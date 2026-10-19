/**
 * Heizplan PWA — Tado screenshot parity (dark home / detail / settings).
 * @package @heizplan/web
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { CloudQuotaStatus, HealthStatus, ZonesResponse } from "@heizplan/shared";
import { fetchCloudQuota, fetchHealth, fetchZones } from "./api";
import { BottomNav, type NavTab } from "./components/BottomNav";
import { BridgeStatus } from "./components/BridgeStatus";
import { CloudQuotaBadge } from "./components/CloudQuotaBadge";
import { MoreScreen } from "./components/MoreScreen";
import { QuickActions } from "./components/QuickActions";
import { RoomDetail } from "./components/RoomDetail";
import { RoomGrid } from "./components/RoomGrid";
import { ScheduleScreen } from "./components/ScheduleScreen";
import { SettingsScreen } from "./components/SettingsScreen";
import { ChevronDownIcon } from "./components/icons";

const POLL_MS = 15_000;
const HUMIDITY_KEY = "heizplan.showHumidity";
const HOME_NAME_KEY = "heizplan.homeName";

type Overlay =
  | { kind: "none" }
  | { kind: "room"; zoneId: string }
  | { kind: "schedule"; zoneId: string };

function readBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === null) {
      return fallback;
    }
    return v === "1";
  } catch {
    return fallback;
  }
}

export function App() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [zones, setZones] = useState<ZonesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [tab, setTab] = useState<NavTab>("home");
  const [overlay, setOverlay] = useState<Overlay>({ kind: "none" });
  const [showHumidity, setShowHumidity] = useState(() => readBool(HUMIDITY_KEY, true));
  const [quota, setQuota] = useState<CloudQuotaStatus | null>(null);
  const [homeName] = useState(() => {
    try {
      return localStorage.getItem(HOME_NAME_KEY) || "Zuhause";
    } catch {
      return "Zuhause";
    }
  });
  const visibleRef = useRef(
    typeof document !== "undefined" ? document.visibilityState !== "hidden" : true,
  );

  const load = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) {
      setRefreshing(true);
    }
    try {
      const [h, z, q] = await Promise.all([
        fetchHealth(),
        fetchZones(),
        fetchCloudQuota().catch(() => null),
      ]);
      setHealth(h);
      setZones(z);
      if (q) {
        setQuota(q);
      }
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
      if (visibleRef.current) {
        void load({ quiet: true });
      }
    }, POLL_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(id);
    };
  }, [load]);

  useEffect(() => {
    try {
      localStorage.setItem(HUMIDITY_KEY, showHumidity ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [showHumidity]);

  const live = Boolean(zones?.source === "bridge" && health?.bridge.paired && !offline);
  const fixtureMode = zones?.source === "mock" && !offline;
  /** Live bridge or fixtures (mock power / open-window smoke). */
  const interactive = live || fixtureMode;

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
                overlayActive: tempC !== null,
                onSchedule: false,
                updatedAt: new Date().toISOString(),
              }
            : z,
        ),
      };
    });
  }

  const roomZone =
    overlay.kind === "room" || overlay.kind === "schedule"
      ? zones?.zones.find((z) => z.id === overlay.zoneId)
      : undefined;

  if (overlay.kind === "schedule" && roomZone) {
    return (
      <div className="app-shell app-shell--overlay">
        <ScheduleScreen
          zone={roomZone}
          onBack={() => setOverlay({ kind: "room", zoneId: roomZone.id })}
          onQuotaChange={setQuota}
        />
      </div>
    );
  }

  if (overlay.kind === "room" && roomZone) {
    return (
      <div className="app-shell app-shell--overlay">
        <RoomDetail
          zone={roomZone}
          interactive={interactive}
          showHumidity={showHumidity}
          onClose={() => setOverlay({ kind: "none" })}
          onOpenSchedule={() => setOverlay({ kind: "schedule", zoneId: roomZone.id })}
          onOptimisticTarget={patchTarget}
          onChanged={() => void load({ quiet: true })}
        />
      </div>
    );
  }

  return (
    <div className="app-shell app-shell--nav">
      {tab === "home" ? (
        <>
          <a className="promo-banner" href="#skills-stub">
            <span className="promo-banner__badge" aria-hidden="true">
              A
            </span>
            <span>Lass uns dein Zuhause vorwärmen</span>
            <span aria-hidden="true">→</span>
          </a>

          <header className="home-header">
            <button type="button" className="home-header__name">
              {homeName}
              <ChevronDownIcon />
            </button>
          </header>

          <BridgeStatus
            health={health}
            zones={zones}
            offline={offline}
            lastUpdated={lastUpdated}
            refreshing={refreshing}
            onRefresh={() => void load()}
          />

          <CloudQuotaBadge quota={quota} />

          {error && offline ? (
            <div className="error-state" role="alert">
              {error}
            </div>
          ) : null}

          {!offline && health && !health.bridge.paired ? (
            <div className="callout" role="status">
              <strong>Bridge nicht gepaart.</strong>
              {fixtureMode
                ? " Fixtures aktiv — Layout wie Tado-Screenshots testbar."
                : " Pairing: POST /api/bridge/pair"}
            </div>
          ) : null}

          {!offline ? (
            <>
              <QuickActions
                interactive={interactive}
                zones={zones?.zones ?? []}
                onDone={() => void load({ quiet: true })}
              />
              <RoomGrid
                zones={zones?.zones ?? []}
                showHumidity={showHumidity}
                onSelect={(zoneId) => setOverlay({ kind: "room", zoneId })}
              />
            </>
          ) : null}

          <p id="skills-stub" className="footer-note">
            {live
              ? "Live HomeKit · Tippe eine Kachel."
              : fixtureMode
                ? "Fixtures · Screenshot-Parität; Live-Smoke auf Self-Hosted."
                : "Nach Pairing: Live-Räume."}
          </p>
        </>
      ) : null}

      {tab === "settings" ? (
        <SettingsScreen
          health={health}
          zones={zones}
          showHumidity={showHumidity}
          onShowHumidityChange={setShowHumidity}
          quota={quota}
          onQuotaChange={setQuota}
        />
      ) : null}

      {tab === "more" ? <MoreScreen /> : null}

      <BottomNav active={tab} onChange={setTab} />
    </div>
  );
}
