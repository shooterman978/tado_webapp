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
  postProtocolClientEvent,
} from "./api";
import { AutomationHome } from "./components/AutomationHome";
import { BridgePanel } from "./components/BridgePanel";
import { BridgeStatus } from "./components/BridgeStatus";
import { CalendarRulesScreen } from "./components/CalendarRulesScreen";
import { CloudLinkPanel } from "./components/CloudLinkPanel";
import { CloudPanel } from "./components/CloudPanel";
import { DashboardSkeleton } from "./components/DashboardSkeleton";
import { DisplayPanel } from "./components/DisplayPanel";
import { EmptyState } from "./components/EmptyState";
import { GeofencingPanel } from "./components/GeofencingPanel";
import { HomeCloudSync } from "./components/HomeCloudSync";
import { OpenWindowPanel } from "./components/OpenWindowPanel";
import { ProtocolPanel } from "./components/ProtocolPanel";
import { RoomDetail } from "./components/RoomDetail";
import { RoomGrid } from "./components/RoomGrid";
import { ScheduleScreen } from "./components/ScheduleScreen";
import { SystemPanel } from "./components/SystemPanel";
import { ChevronIcon, RetryIcon, SlidersIcon, WarmupIcon } from "./components/icons";

const POLL_MS = 15_000;
const HUMIDITY_KEY = "heizplan.showHumidity";
const HOME_NAME_KEY = "heizplan.homeName";

/** Drill-ins that can open from dashboard or from the System hub. */
type SystemVia = "dashboard" | "system";

/**
 * Navigation model — one dashboard root + breadcrumb drill-ins.
 * Automations first; System/Cloud/Quota live behind a single hub.
 */
type AppView =
  | { kind: "dashboard" }
  | { kind: "windows" }
  | { kind: "system" }
  | { kind: "cloud"; via?: SystemVia }
  | { kind: "bridge"; via?: SystemVia }
  | { kind: "geofencing" }
  | { kind: "display"; via?: SystemVia }
  | { kind: "protocol"; via?: SystemVia }
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
  const [refreshing, setRefreshing] = useState(true);
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
  const goSystem = useCallback(() => setView({ kind: "system" }), []);

  function backFromSystemChild(via?: SystemVia): void {
    if (via === "system") {
      goSystem();
    } else {
      goDashboard();
    }
  }

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
      const raw = err instanceof Error ? err.message : "Laden fehlgeschlagen";
      const message =
        /failed to fetch|networkerror|load failed/i.test(raw)
          ? "Server nicht erreichbar"
          : raw;
      setOffline(true);
      setError(message);
      setQuotaLoading(false);
      void postProtocolClientEvent({
        category: "feedback",
        type: "feedback.error",
        message: "Dashboard-Laden fehlgeschlagen",
        detail: { message: message.slice(0, 200) },
      }).catch(() => {
        /* ignore */
      });
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

  if (view.kind === "system") {
    return (
      <div className="app-shell app-shell--drill">
        <SystemPanel
          health={health}
          zones={zones}
          quota={quota}
          onOpenCloud={() => setView({ kind: "cloud", via: "system" })}
          onOpenBridge={() => setView({ kind: "bridge", via: "system" })}
          onOpenDisplay={() => setView({ kind: "display", via: "system" })}
          onOpenProtocol={() => setView({ kind: "protocol", via: "system" })}
          onBack={goDashboard}
          onHome={goDashboard}
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
          onSynced={() => void load({ quiet: true })}
          onBack={() => backFromSystemChild(view.via)}
          onHome={goDashboard}
          onOpenProtocol={() =>
            setView({ kind: "protocol", via: view.via ?? "dashboard" })
          }
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
          onBack={() => backFromSystemChild(view.via)}
          onHome={goDashboard}
          onOpenCloud={() => setView({ kind: "cloud", via: view.via ?? "dashboard" })}
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
          onBack={() => backFromSystemChild(view.via)}
          onHome={goDashboard}
        />
      </div>
    );
  }

  if (view.kind === "protocol") {
    return (
      <div className="app-shell app-shell--drill">
        <ProtocolPanel
          onBack={() => backFromSystemChild(view.via)}
          onHome={goDashboard}
          onOpenCloud={() =>
            setView({ kind: "cloud", via: view.via ?? "dashboard" })
          }
        />
      </div>
    );
  }

  const bootLoading = !offline && !health && !zones;
  const showWarmupPromo =
    !offline && !bootLoading && calendarMeta.ruleCount === 0;

  return (
    <div className="app-shell app-shell--dashboard">
      {/* Silent auto-sync — no hero chrome; UI lives under System › Cloud */}
      {!offline ? (
        <HomeCloudSync
          variant="silent"
          onSynced={() => void load({ quiet: true })}
          onQuotaChange={(q) => {
            setQuota(q);
            setQuotaUnavailable(null);
            setQuotaLoading(false);
          }}
        />
      ) : null}

      <header className="home-header">
        <p className="home-header__brand">Heizplan</p>
        <h1 className="home-header__name">{homeName}</h1>
      </header>

      <BridgeStatus
        health={health}
        zones={zones}
        offline={offline}
        lastUpdated={lastUpdated}
        refreshing={refreshing}
        onRefresh={() => void load()}
        onOpenDetail={() => setView({ kind: "bridge", via: "dashboard" })}
      />

      {offline ? (
        <EmptyState
          tone="offline"
          role="alert"
          icon={<RetryIcon />}
          title="Keine Verbindung"
          body={
            error
              ? `${error}. Automationen und die letzte Anzeige sind gerade nicht erreichbar.`
              : "Automationen und die letzte Anzeige sind gerade nicht erreichbar."
          }
          actionLabel={refreshing ? "Wird versucht …" : "Erneut versuchen"}
          onAction={() => void load()}
        />
      ) : null}

      {bootLoading ? <DashboardSkeleton /> : null}

      {!offline && !bootLoading ? (
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

      {showWarmupPromo ? (
        <button
          type="button"
          className="promo-banner promo-banner--after-auto"
          onClick={() => setView({ kind: "calendar-rules" })}
        >
          <span className="promo-banner__badge" aria-hidden="true">
            <WarmupIcon />
          </span>
          <span>Lass uns dein Zuhause vorwärmen</span>
          <span aria-hidden="true">→</span>
        </button>
      ) : null}

      {!offline && !bootLoading && health && !health.bridge.paired ? (
        <div className="callout callout--compact" role="status">
          <strong>Bridge noch nicht verbunden.</strong>
          {fixtureMode
            ? " Testdaten aktiv — du kannst die Oberfläche schon ansehen."
            : " Unter System → Bridge verbindest du die Heizung."}
        </div>
      ) : null}

      {!offline &&
      !bootLoading &&
      health?.bridge.paired &&
      zones?.naming &&
      zones.naming.source !== "cloud" &&
      zones.naming.source !== "map" ? (
        <div className="callout callout--names callout--compact" role="status">
          <strong>Raumnamen von der Bridge</strong>
          <span>Einmal Tado Cloud verknüpfen → vertraute Raumnamen.</span>
          <CloudLinkPanel naming={zones.naming} onLinked={() => void load({ quiet: true })} />
        </div>
      ) : null}

      {!bootLoading ? (
        <section className="dash-more" aria-label="Mehr">
          <button
            type="button"
            className="settings-row settings-row--button dash-more__system"
            onClick={() => setView({ kind: "system" })}
          >
            <span
              className="settings-row__circle settings-row__circle--icon"
              style={{ background: "#2c2c2e" }}
              aria-hidden="true"
            >
              <SlidersIcon />
            </span>
            <span className="settings-row__label">
              System
              <small className="settings-row__sub">Cloud, Bridge, Darstellung, Protokoll</small>
            </span>
            <ChevronIcon className="settings-row__chev" />
          </button>

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
        </section>
      ) : null}

      <p className="footer-note">
        {live
          ? "Live · Automatisierung zuerst."
          : fixtureMode
            ? "Testdaten · Automations-Übersicht."
            : "Nach dem Verbinden: Live-Status."}
      </p>
    </div>
  );
}

/** Stable view kind for Protokoll drill-in. */
export type ProtocolView = { kind: "protocol" };
