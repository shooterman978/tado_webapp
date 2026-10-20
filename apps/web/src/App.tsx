/**
 * Heizplan PWA — Tado screenshot parity (dark home / detail / settings).
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
  ApiError,
  fetchCalendarStatus,
  fetchCloudQuota,
  fetchHealth,
  fetchOpenWindowSettings,
  fetchZones,
  refreshHomePresence,
} from "./api";
import { AutomationHome } from "./components/AutomationHome";
import { BottomNav, type NavTab } from "./components/BottomNav";
import { BridgeStatus } from "./components/BridgeStatus";
import { CloudLinkPanel } from "./components/CloudLinkPanel";
import { CloudQuotaBadge } from "./components/CloudQuotaBadge";
import { HomeCloudSync } from "./components/HomeCloudSync";
import { MoreScreen } from "./components/MoreScreen";
import { RoomDetail } from "./components/RoomDetail";
import { RoomGrid } from "./components/RoomGrid";
import { CalendarRulesScreen } from "./components/CalendarRulesScreen";
import { ScheduleScreen } from "./components/ScheduleScreen";
import { SettingsScreen } from "./components/SettingsScreen";
import { ChevronDownIcon } from "./components/icons";

const POLL_MS = 15_000;
const HUMIDITY_KEY = "heizplan.showHumidity";
const HOME_NAME_KEY = "heizplan.homeName";
type Overlay =
  | { kind: "none" }
  | { kind: "room"; zoneId: string }
  | { kind: "schedule"; zoneId: string }
  | { kind: "calendar-rules"; zoneId?: string };

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
  const [quotaLoading, setQuotaLoading] = useState(true);
  const [quotaUnavailable, setQuotaUnavailable] = useState<string | null>(null);
  const [calendarMeta, setCalendarMeta] = useState<{
    ruleCount: number;
    configured: boolean;
  }>({ ruleCount: 0, configured: false });
  const [openWindow, setOpenWindow] = useState<OpenWindowSettings | null>(null);
  const [presenceBusy, setPresenceBusy] = useState(false);
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
  }, [overlay.kind]);

  async function refreshPresenceFromHome(): Promise<void> {
    setPresenceBusy(true);
    try {
      const res = await refreshHomePresence(true);
      setQuota(res.quota);
      setQuotaUnavailable(null);
      await load({ quiet: true });
    } catch (err) {
      if (err instanceof ApiError && err.quota) {
        setQuota(err.quota);
      }
    } finally {
      setPresenceBusy(false);
    }
  }

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

  const roomZone =
    overlay.kind === "room" || overlay.kind === "schedule"
      ? zones?.zones.find((z) => z.id === overlay.zoneId)
      : undefined;

  if (overlay.kind === "calendar-rules") {
    return (
      <div className="app-shell app-shell--overlay">
        <CalendarRulesScreen
          zones={zones?.zones ?? []}
          focusRoomId={overlay.zoneId ?? null}
          onBack={() => {
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
            if (overlay.zoneId) {
              setOverlay({ kind: "schedule", zoneId: overlay.zoneId });
            } else {
              setOverlay({ kind: "none" });
            }
          }}
          onQuotaChange={setQuota}
        />
      </div>
    );
  }

  if (overlay.kind === "schedule" && roomZone) {
    return (
      <div className="app-shell app-shell--overlay">
        <ScheduleScreen
          zone={roomZone}
          onBack={() => setOverlay({ kind: "room", zoneId: roomZone.id })}
          onQuotaChange={setQuota}
          onOpenCalendarRules={() =>
            setOverlay({ kind: "calendar-rules", zoneId: roomZone.id })
          }
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
          onOptimisticResume={patchResume}
          onChanged={() => void load({ quiet: true })}
        />
      </div>
    );
  }

  return (
    <div className="app-shell app-shell--nav">
      {tab === "home" ? (
        <>
          <button
            type="button"
            className="promo-banner"
            onClick={() => setOverlay({ kind: "calendar-rules" })}
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
              <span>
                Einmal Tado Cloud verknüpfen → echte Raumnamen.
              </span>
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
              onOpenCalendar={() => setOverlay({ kind: "calendar-rules" })}
              onOpenWindows={() => setTab("settings")}
              onRefreshPresence={() => void refreshPresenceFromHome()}
              presenceBusy={presenceBusy}
            />
          ) : null}

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
                onSelect={(zoneId) => setOverlay({ kind: "room", zoneId })}
              />
            </details>
          ) : null}

          <p id="skills-stub" className="footer-note">
            {live
              ? "Live · Automatisierung zuerst."
              : fixtureMode
                ? "Fixtures · Automations-Dashboard."
                : "Nach Pairing: Live-Status."}
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
          onQuotaChange={(q) => {
            setQuota(q);
            setQuotaUnavailable(null);
            setQuotaLoading(false);
          }}
          quotaLoading={quotaLoading}
          quotaUnavailable={quotaUnavailable}
          onZonesRefresh={() => void load({ quiet: true })}
          onOpenCalendarRules={() => setOverlay({ kind: "calendar-rules" })}
          presence={zones?.presence}
        />
      ) : null}

      {tab === "more" ? (
        <MoreScreen onOpenCalendarRules={() => setOverlay({ kind: "calendar-rules" })} />
      ) : null}

      <BottomNav active={tab} onChange={setTab} />
    </div>
  );
}
