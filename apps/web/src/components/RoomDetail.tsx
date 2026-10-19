/**
 * Room detail — olive bg, vertical white slider (screenshot 01).
 * @package @heizplan/web
 */

import { useEffect, useRef, useState } from "react";
import type { HeatupPrediction, Zone } from "@heizplan/shared";
import {
  clearZoneOverlay,
  fetchCloudSyncStatus,
  fetchHeatupSummary,
  setZonePower,
  setZoneTemperature,
} from "../api";
import {
  detailBackground,
  formatTemp,
  heatMode,
  isActivelyHeating,
} from "../lib/zoneDisplay";
import {
  CloseIcon,
  HeatWavesIcon,
  PencilIcon,
  PowerIcon,
  ReportIcon,
  ScheduleIcon,
  ScheduleResumeIcon,
  WindowIcon,
} from "./icons";
import { TempDisplay } from "./TempDisplay";

interface RoomDetailProps {
  zone: Zone;
  interactive: boolean;
  showHumidity: boolean;
  onClose: () => void;
  onOpenSchedule: () => void;
  onOptimisticTarget: (zoneId: string, tempC: number | null) => void;
  /** Clear manual overlay in local UI before / after resume API. */
  onOptimisticResume: (zoneId: string) => void;
  onChanged: () => void;
}

const MIN_T = 5;
const MAX_T = 25;

function formatRecommendTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function tempFromY(clientY: number, rect: DOMRect): number {
  const ratio = 1 - (clientY - rect.top) / rect.height;
  const raw = MIN_T + ratio * (MAX_T - MIN_T);
  return Math.round(Math.min(MAX_T, Math.max(MIN_T, raw)) * 2) / 2;
}

/** True when room is off the Smart Schedule (manual or calendar). */
function isOverrideActive(zone: Zone): boolean {
  return (
    zone.overlayControl === "manual" ||
    zone.overlayControl === "calendar" ||
    zone.overlayActive === true
  );
}

function footerStatusLabel(zone: Zone, off: boolean): string {
  if (zone.overlayControl === "calendar" || (zone.overlayActive && zone.calendarRuleName)) {
    const rule = zone.calendarRuleName?.trim();
    return rule ? `Terminsteuerung · ${rule}` : "Terminsteuerung";
  }
  if (zone.overlayControl === "manual" || zone.overlayActive) {
    return "Manuelle Überschreibung";
  }
  if (off) {
    return "Aus / Frostschutz";
  }
  return "Folgt dem Zeitplan";
}

export function RoomDetail({
  zone,
  interactive,
  showHumidity,
  onClose,
  onOpenSchedule,
  onOptimisticTarget,
  onOptimisticResume,
  onChanged,
}: RoomDetailProps) {
  const [draft, setDraft] = useState(zone.targetTempC ?? 20);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [homeSyncedAt, setHomeSyncedAt] = useState<string | null>(null);
  const [scheduleSyncedAt, setScheduleSyncedAt] = useState<string | null>(null);
  const [heatup, setHeatup] = useState<HeatupPrediction | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    if (zone.targetTempC != null) {
      setDraft(zone.targetTempC);
    }
  }, [zone.id, zone.targetTempC]);

  /** Disk-only sync stamps — opening a room must not hit Tado cloud. */
  useEffect(() => {
    let cancelled = false;
    void fetchCloudSyncStatus()
      .then((s) => {
        if (cancelled) {
          return;
        }
        setHomeSyncedAt(s.lastSyncedAt);
        setScheduleSyncedAt(s.scheduleSyncedAt[zone.id] ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          setHomeSyncedAt(null);
          setScheduleSyncedAt(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [zone.id]);

  useEffect(() => {
    if (
      zone.heatupHint?.recommendedStartAt &&
      zone.heatupHint.estimatedMinutes != null
    ) {
      setHeatup({
        roomId: zone.id,
        targetTempC: zone.targetTempC ?? 22,
        currentTempC: zone.currentTempC,
        outdoorTempC: zone.heatupHint.outdoorTempC,
        outdoorProvider: null,
        estimatedMinutes: zone.heatupHint.estimatedMinutes,
        recommendedStartAt: zone.heatupHint.recommendedStartAt,
        readyAt: new Date().toISOString(),
        confidence: zone.heatupHint.sampleCount >= 7 ? "high" : "medium",
        method: zone.heatupHint.method,
        sampleCount: zone.heatupHint.sampleCount,
        message: zone.heatupHint.message,
      });
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const summary = await fetchHeatupSummary(zone.id, {
          currentTempC: zone.currentTempC,
          targetTempC: zone.targetTempC ?? 22,
        });
        if (!cancelled && summary.readyForUi && summary.latestPrediction) {
          setHeatup(summary.latestPrediction);
        } else if (!cancelled) {
          setHeatup(null);
        }
      } catch {
        if (!cancelled) {
          setHeatup(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [zone.id, zone.currentTempC, zone.targetTempC, zone.heatupHint]);

  function formatSyncStamp(iso: string | null): string {
    if (!iso) {
      return "—";
    }
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      return "—";
    }
    return d.toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const off = heatMode(zone) === "off";
  const heating = isActivelyHeating(zone);
  const overrideActive = isOverrideActive(zone);
  const fillPct = Math.min(100, Math.max(8, ((draft - MIN_T) / (MAX_T - MIN_T)) * 100));
  const bg = detailBackground(zone);

  async function commit(next: number): Promise<void> {
    if (!interactive) {
      return;
    }
    const previous = zone.targetTempC;
    setBusy(true);
    setError(null);
    onOptimisticTarget(zone.id, next);
    try {
      await setZoneTemperature(zone.id, next, null);
      onChanged();
    } catch (err) {
      onOptimisticTarget(zone.id, previous);
      if (previous != null) {
        setDraft(previous);
      }
      setError(err instanceof Error ? err.message : "Soll fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  async function resume(): Promise<void> {
    if (!interactive || !overrideActive) {
      return;
    }
    setBusy(true);
    setError(null);
    onOptimisticResume(zone.id);
    try {
      await clearZoneOverlay(zone.id);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Zeitplan fehlgeschlagen");
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function turnOffForWindow(): Promise<void> {
    if (!interactive) {
      return;
    }
    setBusy(true);
    setError(null);
    onOptimisticTarget(zone.id, null);
    try {
      await setZonePower(zone.id, "off");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ausschalten fehlgeschlagen");
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  function onPointer(clientY: number): void {
    const el = trackRef.current;
    if (!el) {
      return;
    }
    setDraft(tempFromY(clientY, el.getBoundingClientRect()));
  }

  return (
    <div className="room-detail" style={{ ["--detail-bg" as string]: bg }}>
      <header className="room-detail__bar">
        <button type="button" className="room-detail__icon-btn" onClick={onClose} aria-label="Schließen">
          <CloseIcon />
        </button>
        <h1 className="room-detail__title">{zone.name}</h1>
        <div className="room-detail__actions">
          <button
            type="button"
            className="room-detail__icon-btn"
            onClick={onOpenSchedule}
            aria-label="Intelligenter Zeitplan"
          >
            <ScheduleIcon />
          </button>
          <button
            type="button"
            className="room-detail__icon-btn"
            aria-label="Climate Report (folgt)"
            disabled
          >
            <ReportIcon />
          </button>
        </div>
      </header>

      <div className="room-detail__stats">
        <p>
          <span className="room-detail__stat-label">Aktuell</span>{" "}
          <strong>{formatTemp(zone.currentTempC)}°</strong>
        </p>
        {showHumidity && zone.humidityPercent != null ? (
          <p>
            <span className="room-detail__stat-label">Luftfeuchtigkeit</span>{" "}
            <strong>{zone.humidityPercent}%</strong>
          </p>
        ) : null}
      </div>

      <p className="room-detail__sync-stamp">
        Cloud Home {formatSyncStamp(homeSyncedAt)}
        {" · "}
        Zeitplan {formatSyncStamp(scheduleSyncedAt)}
        {" (Sync im Zeitplan)"}
      </p>

      {heatup?.recommendedStartAt && heatup.estimatedMinutes != null ? (
        <p className="heatup-hint" role="status">
          <span className="heatup-hint__label">Start empfohlen um</span>{" "}
          <strong>{formatRecommendTime(heatup.recommendedStartAt)}</strong>
          <span className="heatup-hint__detail">
            Vorlauf ~{Math.round(heatup.estimatedMinutes)} min
            {heatup.outdoorTempC != null
              ? ` · ${Math.round(heatup.outdoorTempC)}°C außen`
              : ""}
            {heatup.method === "model0" || heatup.method === "model3"
              ? ` · ${heatup.method === "model0" ? "Model 0" : "Model 3"}`
              : ""}
          </span>
        </p>
      ) : null}

      {zone.windowOpen ? (
        <div className="window-banner" role="status">
          <WindowIcon className="window-banner__icon" />
          <div className="window-banner__text">
            <strong>Fenster offen</strong>
            <span>
              {zone.openWindowAutoOffActive
                ? "Heizung lokal aus (Auto-Aus)."
                : "Heizung bei Bedarf ausschalten — ohne Auto-Assist."}
            </span>
          </div>
          {!off ? (
            <button
              type="button"
              className="window-banner__action"
              disabled={busy || !interactive}
              onClick={() => void turnOffForWindow()}
            >
              <PowerIcon />
              Heizung ausschalten
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="room-detail__soll-row">
        <TempDisplay value={off ? null : draft} size="detail" off={off} />
        {(heating || (!off && zone.targetTempC != null)) ? (
          <HeatWavesIcon
            className={[
              "room-detail__waves",
              heating ? "is-active" : "is-idle",
            ].join(" ")}
          />
        ) : null}
      </div>

      <div className="room-detail__slider-wrap">
        <div
          className={["v-slider", off ? "is-disabled" : ""].filter(Boolean).join(" ")}
          ref={trackRef}
          role="slider"
          aria-valuemin={MIN_T}
          aria-valuemax={MAX_T}
          aria-valuenow={draft}
          aria-label="Solltemperatur"
          tabIndex={interactive && !off ? 0 : -1}
          onPointerDown={(e) => {
            if (!interactive || off) {
              return;
            }
            dragging.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            onPointer(e.clientY);
          }}
          onPointerMove={(e) => {
            if (!dragging.current) {
              return;
            }
            onPointer(e.clientY);
          }}
          onPointerUp={(e) => {
            if (!dragging.current) {
              return;
            }
            dragging.current = false;
            const next = tempFromY(e.clientY, e.currentTarget.getBoundingClientRect());
            setDraft(next);
            void commit(next);
          }}
          onKeyDown={(e) => {
            if (!interactive || off) {
              return;
            }
            if (e.key === "ArrowUp" || e.key === "ArrowRight") {
              const next = Math.min(MAX_T, draft + 0.5);
              setDraft(next);
              void commit(next);
            }
            if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
              const next = Math.max(MIN_T, draft - 0.5);
              setDraft(next);
              void commit(next);
            }
          }}
        >
          <div className="v-slider__well">
            <div
              className="v-slider__fill"
              style={{ height: `${fillPct}%` }}
              aria-hidden="true"
            />
            <span
              className="v-slider__grip"
              style={{ bottom: `calc(${fillPct}% - 0.1rem)` }}
              aria-hidden="true"
            />
          </div>
        </div>
      </div>

      <div className="room-detail__bottom">
        {overrideActive ? (
          <button
            type="button"
            className="room-detail__resume"
            disabled={busy || !interactive}
            aria-label="Zeitplan fortsetzen"
            onClick={() => void resume()}
          >
            <ScheduleResumeIcon />
            Zeitplan fortsetzen
          </button>
        ) : null}

        <footer className="room-detail__footer">
          <div className="room-detail__footer-main">
            {!overrideActive ? <ScheduleIcon /> : null}
            <span>{footerStatusLabel(zone, off)}</span>
          </div>
          <button
            type="button"
            className="room-detail__edit"
            aria-label="Overlay bearbeiten"
            disabled={!interactive || off}
            onClick={() => {
              if (!interactive || off) {
                return;
              }
              void commit(draft);
            }}
          >
            <PencilIcon />
          </button>
        </footer>
      </div>

      {error ? (
        <p className="error-state" role="alert">
          {error}
        </p>
      ) : null}
      {!interactive ? (
        <p className="room-detail__hint">Steuerung nach Bridge-Pairing.</p>
      ) : null}
    </div>
  );
}
