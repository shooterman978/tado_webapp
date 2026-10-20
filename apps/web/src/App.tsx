/**
 * Heizplan PWA — single dashboard shell (Tado dark look).
 * Home + settings unified; drill-ins via breadcrumbs. No bottom tabs.
 * @package @heizplan/web
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CloudQuotaStatus,
  HealthStatus,
  OpenWindowSettings,
  ZonesResponse,
} from "@heizplan/shared";
import {
  fetchCalendarStatus,
  fetchCloudQuota,
  fetchHealth,
  fetchOpenWindowSettings,
  fetchZones,
} from "./api";
import { AutomationHome } from "./components/AutomationHome";
import { BridgePanel } from "./components/BridgePanel";
import { BridgeStatus } from "./components/BridgeStatus";
import { CalendarRulesScreen } from "./components/CalendarRulesScreen";
import { CloudLinkPanel } from "./components/CloudLinkPanel";
import { CloudPanel } from "./components/CloudPanel";
import { CloudQuotaBadge } from "./components/CloudQuotaBadge";
import { DisplayPanel } from "./components/DisplayPanel";
import { GeofencingPanel } from "./components/GeofencingPanel";
import { HomeCloudSync } from "./components/HomeCloudSync";
import { OpenWindowPanel } from "./components/OpenWindowPanel";
import { RoomDetail } from "./components/RoomDetail";
import { RoomGrid } from "./components/RoomGrid";
import { ScheduleScreen } from "./components/ScheduleScreen";
import { ChevronDownIcon, ChevronIcon } from "./components/icons";

const POLL_MS = 15_000;
const HUMIDITY_KEY = "heizplan.showHumidity";
const HOME_NAME_KEY = "heizplan.homeName";

/**
 * Navigation model — one dashboard root + breadcrumb drill-ins.
 * Reserved for a later turn (do not implement UI yet): "protocol" / Protokoll logs.
 */
type AppView =
  | { kind: "dashboard" }
  | { kind: "windows" }
  | { kind: "cloud" }
  | { kind: "bridge" }
  | { kind: "geofencing" }
  | { kind: "display" }
  | { kind: "calendar-rules"; zoneId?: string }
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
  const [view, setView] = useState<AppView>({ kind: "dashboard" });
  const [showHumidity, setShowHumidity] = useState(() => readBool(HUMIDITY_KEY, true));
  const [quota, setQuota] = useState<CloudQuotaStatus | null>(null);
  const [quotaLoading, setQuotaLoading] = useState(true);
  const [quotaUnavailable, setQuotaUnavailable] = useState<string | null>(null);
  const [calendarMeta, setCalendarMeta] = useState<{
    ruleCount: number;
    configured: boolean;
  }>({ ruleCount: 0, configured: false });
  const [openWindow, setOpenWindow] = useState<OpenWindowSettings | null>(null);
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

  const goDashboard = useCallback(() => setView({ kind: "dashboard" }), []);

  const load = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) {
      setRefreshing(true);
    }
    try {
      const [h, z, qResult] = await Promise.all([
        fetchHealth(),
        fetchZones(),
        fetchCloudQuota()
          .then((q) => ({ ok: true as const, q }))
          .catch((err: unknown) => ({
            ok: false as const,
            message: err instanceof Error ? err.message : "Quota-API fehlt",
          })),
      ]);
      setHealth(h);
      setZones(z);
      if (qResult.ok) {
        setQuota(qResult.q);
        setQuotaUnavailable(null);
      } else {
        setQuota(null);
        setQuotaUnavailable(qResult.message);
      }
      setQuotaLoading(false);
      setError(null);
      setOffline(false);
      setLastUpdated(new Date());
    } catch (err) {
      setOffline(true);
      setError(err instanceof Error ? err.message : "Laden fehlgeschlagen");
      setQuotaLoading(false);
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
    let cancelled = false;
    void fetchCalendarStatus()
      .then((s) => {
        if (!cancelled) {
          setCalendarMeta({
            ruleCount: s.rules?.length ?? 0,
            configured: Boolean(s.connection?.configured),
          });
        }
      })
      .catch(() => {
        /* optional */
      });
    void fetchOpenWindowSettings()
      .then((ow) => {
        if (!cancelled) {
          setOpenWindow(ow);
        }
      })
      .catch(() => {
        /* optional */
      });
    return () => {
      cancelled = true;
    };
  }, [view.kind]);

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
                followsSchedule: false,
                overlayControl: tempC !== null ? ("manual" as const) : ("none" as const),
                offScheduleReason:
                  tempC !== null ? ("manual_overlay" as const) : null,
                calendarRuleName: null,
                calendarRuleId: null,
                overlayEndsAt: null,
                updatedAt: new Date().toISOString(),
              }
            : z,
        ),
      };
    });
  }

  function patchResume(zoneId: string): void {
    setZones((prev) => {
      if (!prev) {
        return prev;
      }
      return {
        ...prev,
        zones: prev.zones.map((z) => {
          if (z.id !== zoneId) {
            return z;
          }
          // Optimistic: move toward cached schedule target, but never claim
          // followsSchedule — next zones poll re-compares HAP vs cache.
          const nextTarget =
            z.scheduleTargetTempC !== undefined && z.scheduleTargetTempC !== null
              ? z.scheduleTargetTempC
              : z.targetTempC;
          return {
            ...z,
            targetTempC: nextTarget,
            overlayActive: false,
            onSchedule: false,
            followsSchedule: null,
            overlayControl: "none" as const,
            offScheduleReason: null,
            calendarRuleName: null,
            calendarRuleId: null,
            overlayEndsAt: null,
            updatedAt: new Date().toISOString(),
          };
        }),
      };
    });
  }

  function afterCalendarBack(zoneId?: string): void {
    void fetchCalendarStatus()
      .then((s) => {
        setCalendarMeta({
          ruleCount: s.rules?.length ?? 0,
          configured: Boolean(s.connection?.configured),
        });
      })
      .catch(() => {
        /* ignore */
      });
    if (zoneId) {
      setView({ kind: "schedule", zoneId });
    } else {
      goDashboard();
    }
  }

  const roomZone =
    view.kind === "room" || view.kind === "schedule"
      ? zones?.zones.find((z) => z.id === view.zoneId)
      : undefined;

  if (view.kind === "calendar-rules") {
    return (
      <div className="app-shell app-shell--drill">
        <CalendarRulesScreen
          zones={zones?.zones ?? []}
          focusRoomId={view.zoneId ?? null}
          breadcrumbRoot="Heizplan"
          onBack={() => afterCalendarBack(view.zoneId)}
          onHome={goDashboard}
          onQuotaChange={setQuota}
        />
      </div>
    );
  }

  if (view.kind === "schedule" && roomZone) {
    return (
      <div className="app-shell app-shell--drill">
        <ScheduleScreen
          zone={roomZone}
          onBack={() => setView({ kind: "room", zoneId: roomZone.id })}
          onQuotaChange={setQuota}
          onOpenCalendarRules={() =>
            setView({ kind: "calendar-rules", zoneId: roomZone.id })
          }
        />
      </div>
    );
  }

  if (view.kind === "room" && roomZone) {
    return (
      <div className="app-shell app-shell--drill">
        <RoomDetail
          zone={roomZone}
          interactive={interactive}
          showHumidity={showHumidity}
          onClose={goDashboard}
          onOpenSchedule={() => setView({ kind: "schedule", zoneId: roomZone.id })}
          onOptimisticTarget={patchTarget}
          onOptimisticResume={patchResume}
          onChanged={() => void load({ quiet: true })}
        />
      </div>
    );
  }

  if (view.kind === "windows") {
    return (
      <div className="app-shell app-shell--drill">
        <OpenWindowPanel
          zones={zones?.zones ?? []}
          onBack={goDashboard}
          onHome={goDashboard}
          onSettingsChange={setOpenWindow}
        />
      </div>
    );
  }

  if (view.kind === "cloud") {
    return (
      <div className="app-shell app-shell--drill">
        <CloudPanel
          naming={zones?.naming}
          quota={quota}
          quotaLoading={quotaLoading}
          quotaUnavailable={quotaUnavailable}
          onQuotaChange={(q) => {
            setQuota(q);
            setQuotaUnavailable(null);
            setQuotaLoading(false);
          }}
          onLinked={() => void load({ quiet: true })}
          onBack={goDashboard}
          onHome={goDashboard}
        />
      </div>
    );
  }

  if (view.kind === "bridge") {
    return (
      <div className="app-shell app-shell--drill">
        <BridgePanel
          health={health}
          zones={zones}
          onBack={goDashboard}
          onHome={goDashboard}
          onOpenCloud={() => setView({ kind: "cloud" })}
        />
      </div>
    );
  }

  if (view.kind === "geofencing") {
    return (
      <div className="app-shell app-shell--drill">
        <GeofencingPanel
          presence={zones?.presence}
          onQuotaChange={(q) => {
            setQuota(q);
            setQuotaUnavailable(null);
          }}
          onZonesRefresh={() => void load({ quiet: true })}
          onBack={goDashboard}
          onHome={goDashboard}
        />
      </div>
    );
  }

  if (view.kind === "display") {
    return (
      <div className="app-shell app-shell--drill">
        <DisplayPanel
          showHumidity={showHumidity}
          onShowHumidityChange={setShowHumidity}
          onBack={goDashboard}
          onHome={goDashboard}
        />
      </div>
    );
  }

  return (
    <div className="app-shell app-shell--dashboard">
      <button
        type="button"
        className="promo-banner"
        onClick={() => setView({ kind: "calendar-rules" })}
      >
        <span className="promo-banner__badge" aria-hidden="true">
          A
        </span>
        <span>Lass uns dein Zuhause vorwärmen</span>
        <span aria-hidden="true">→</span>
      </button>

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
        onOpenDetail={() => setView({ kind: "bridge" })}
      />

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

      {!offline &&
      health?.bridge.paired &&
      zones?.naming &&
      zones.naming.source !== "cloud" &&
      zones.naming.source !== "map" ? (
        <div className="callout callout--names" role="status">
          <strong>HAP-Namen aktiv</strong>
          <span>Einmal Tado Cloud verknüpfen → echte Raumnamen.</span>
          <CloudLinkPanel naming={zones.naming} onLinked={() => void load({ quiet: true })} />
        </div>
      ) : null}

      {!offline ? (
        <AutomationHome
          presence={zones?.presence}
          zones={zones?.zones ?? []}
          openWindow={openWindow}
          calendarRuleCount={calendarMeta.ruleCount}
          calendarConfigured={calendarMeta.configured}
          onOpenCalendar={() => setView({ kind: "calendar-rules" })}
          onOpenWindows={() => setView({ kind: "windows" })}
          onOpenGeofencing={() => setView({ kind: "geofencing" })}
          onOpenHeatup={() => setView({ kind: "calendar-rules" })}
        />
      ) : null}

      <section className="dash-system" aria-label="System">
        <p className="auto-home__label">System</p>
        <div className="settings-group">
          <button
            type="button"
            className="settings-row settings-row--button"
            onClick={() => setView({ kind: "cloud" })}
          >
            <span className="settings-row__circle" style={{ background: "#636366" }} aria-hidden="true">
              C
            </span>
            <span className="settings-row__label">
              Cloud &amp; Quota
              <small className="settings-row__sub">Namen, Limit, Request-Log</small>
            </span>
            <span className="settings-row__meta">
              {quota ? `${quota.remaining}` : "—"}
            </span>
            <ChevronIcon className="settings-row__chev" />
          </button>
          <button
            type="button"
            className="settings-row settings-row--button"
            onClick={() => setView({ kind: "bridge" })}
          >
            <span className="settings-row__circle" style={{ background: "#48484a" }} aria-hidden="true">
              B
            </span>
            <span className="settings-row__label">
              Bridge
              <small className="settings-row__sub">Pairing &amp; Verbindung</small>
            </span>
            <span className="settings-row__meta">
              {health?.bridge.paired ? "OK" : "…"}
            </span>
            <ChevronIcon className="settings-row__chev" />
          </button>
          <button
            type="button"
            className="settings-row settings-row--button"
            onClick={() => setView({ kind: "display" })}
          >
            <span className="settings-row__circle" style={{ background: "#3a3a3c" }} aria-hidden="true">
              D
            </span>
            <span className="settings-row__label">
              Darstellung
              <small className="settings-row__sub">Luftfeuchtigkeit u. a.</small>
            </span>
            <ChevronIcon className="settings-row__chev" />
          </button>
          {/*
            Reserved System row — Parent turn after Unify:
            Protokoll (kind: "protocol") with PageChrome `Heizplan › Protokoll`.
            Events: polling, UI interactions, feedback + agent-analysis
            (calendar apply/clear, presence changes, quota near-limit/block,
            window open/auto-off/resume, heat-up accept/reject, schedule sync,
            bridge disconnect). Do not implement in this branch.
          */}
        </div>
      </section>

      <CloudQuotaBadge
        quota={quota}
        loading={quotaLoading}
        unavailableReason={quotaUnavailable}
      />

      {!offline ? (
        <HomeCloudSync
          onSynced={() => void load({ quiet: true })}
          onQuotaChange={(q) => {
            setQuota(q);
            setQuotaUnavailable(null);
            setQuotaLoading(false);
          }}
        />
      ) : null}

      {!offline ? (
        <details className="home-rooms">
          <summary className="home-rooms__summary">
            Räume (optional · Steuerung in der Tado-App)
          </summary>
          <RoomGrid
            zones={zones?.zones ?? []}
            showHumidity={showHumidity}
            onSelect={(zoneId) => setView({ kind: "room", zoneId })}
          />
        </details>
      ) : null}

      <p className="footer-note">
        {live
          ? "Live · Automatisierung zuerst."
          : fixtureMode
            ? "Fixtures · Automations-Dashboard."
            : "Nach Pairing: Live-Status."}
      </p>
    </div>
  );
}

/** Exported for upcoming Protokoll turn — keep kind name stable. */
export type ReservedProtocolView = { kind: "protocol" };
