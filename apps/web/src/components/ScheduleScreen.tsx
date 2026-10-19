/**
 * Smart Schedule editor — Home timetable + Away config, cloud sync.
 * Layout from screenshot 02; writes go to Tado cloud (visible in official app).
 *
 * CalendarOverride (later): this screen edits the *baseline* cloud plan.
 * Time-bounded calendar rules should layer above via HAP overlay or temporary
 * cloud writes — see CalendarRuleHook in @heizplan/shared and schedule-service.
 *
 * @package @heizplan/web
 */

import { useCallback, useEffect, useState } from "react";
import type {
  CloudQuotaStatus,
  ScheduleBlock,
  ScheduleDayType,
  SchedulePresence,
  TimetableKind,
  Zone,
  ZoneSchedule,
} from "@heizplan/shared";
import {
  ApiError,
  fetchZoneSchedule,
  saveZoneSchedule,
  syncZoneSchedule,
} from "../api";
import { CloudQuotaBadge } from "./CloudQuotaBadge";
import { BackIcon, ChevronIcon } from "./icons";

interface ScheduleScreenProps {
  zone: Zone;
  onBack: () => void;
  onQuotaChange?: (quota: CloudQuotaStatus) => void;
}

const DAY_LABELS: Record<ScheduleDayType, string> = {
  MONDAY_TO_SUNDAY: "Jeden Tag",
  MONDAY_TO_FRIDAY: "Montag–Freitag",
  MONDAY: "Montag",
  TUESDAY: "Dienstag",
  WEDNESDAY: "Mittwoch",
  THURSDAY: "Donnerstag",
  FRIDAY: "Freitag",
  SATURDAY: "Samstag",
  SUNDAY: "Sonntag",
};

const TIMETABLE_META: Record<
  TimetableKind,
  { id: 0 | 1 | 2; daysLabel: string; dayTypes: ScheduleDayType[] }
> = {
  ONE_DAY: {
    id: 0,
    daysLabel: "Jeden Tag",
    dayTypes: ["MONDAY_TO_SUNDAY"],
  },
  THREE_DAY: {
    id: 1,
    daysLabel: "Mo–Fr / Sa / So",
    dayTypes: ["MONDAY_TO_FRIDAY", "SATURDAY", "SUNDAY"],
  },
  SEVEN_DAY: {
    id: 2,
    daysLabel: "Mo, Di, Mi, …",
    dayTypes: [
      "MONDAY",
      "TUESDAY",
      "WEDNESDAY",
      "THURSDAY",
      "FRIDAY",
      "SATURDAY",
      "SUNDAY",
    ],
  },
};

function minutesOf(hhmm: string): number {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) {
    return 0;
  }
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h === 0 && min === 0 && hhmm !== "00:00") {
    return 0;
  }
  // Tado uses end "00:00" for end-of-day.
  return h * 60 + min;
}

function blockFlex(block: ScheduleBlock): number {
  let start = minutesOf(block.start);
  let end = minutesOf(block.end);
  if (end <= start) {
    end = 24 * 60;
  }
  return Math.max(15, end - start);
}

function displayTemp(block: ScheduleBlock): string {
  if (block.power === "OFF" || block.tempC == null) {
    return "Aus";
  }
  return `${block.tempC.toFixed(1)}°`;
}

function blocksForDay(
  schedule: ZoneSchedule,
  dayType: ScheduleDayType,
): ScheduleBlock[] {
  return schedule.homeBlocks
    .filter((b) => b.dayType === dayType)
    .slice()
    .sort((a, b) => minutesOf(a.start) - minutesOf(b.start));
}

function nudgeTemp(block: ScheduleBlock, delta: number): ScheduleBlock {
  if (block.power === "OFF") {
    return { ...block, power: "ON", tempC: 18 };
  }
  const next = Math.round(((block.tempC ?? 18) + delta) * 2) / 2;
  return { ...block, tempC: Math.min(25, Math.max(5, next)) };
}

export function ScheduleScreen({
  zone,
  onBack,
  onQuotaChange,
}: ScheduleScreenProps) {
  const [presence, setPresence] = useState<SchedulePresence>("HOME");
  const [schedule, setSchedule] = useState<ZoneSchedule | null>(null);
  const [quota, setQuota] = useState<CloudQuotaStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<{
    dayType: ScheduleDayType;
    index: number;
  } | null>(null);

  const applyQuota = useCallback(
    (q: CloudQuotaStatus) => {
      setQuota(q);
      onQuotaChange?.(q);
    },
    [onQuotaChange],
  );

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetchZoneSchedule(zone.id);
      setSchedule(res.schedule);
      applyQuota(res.quota);
    } catch (err) {
      if (err instanceof ApiError && err.quota) {
        applyQuota(err.quota);
      }
      setError(err instanceof Error ? err.message : "Zeitplan laden fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }, [zone.id, applyQuota]);

  useEffect(() => {
    void load();
  }, [load]);

  const meta = schedule
    ? TIMETABLE_META[schedule.timetableType] ?? TIMETABLE_META.THREE_DAY
    : TIMETABLE_META.THREE_DAY;

  const dayTypes = meta.dayTypes;

  async function syncNow(): Promise<void> {
    if (quota?.blocked) {
      setError(
        `Cloud-Tageslimit erreicht (${quota.used}/${quota.limit}). Keine Syncs bis Mitternacht Europe/Berlin.`,
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await syncZoneSchedule(zone.id);
      setSchedule(res.schedule);
      applyQuota(res.quota);
    } catch (err) {
      if (err instanceof ApiError && err.quota) {
        applyQuota(err.quota);
      }
      setError(err instanceof Error ? err.message : "Sync fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  async function persistHomeDay(
    dayType: ScheduleDayType,
    blocks: ScheduleBlock[],
  ): Promise<void> {
    if (!schedule) {
      return;
    }
    if (quota?.blocked) {
      setError(
        `Cloud-Tageslimit erreicht (${quota.used}/${quota.limit}). Speichern blockiert bis Mitternacht Europe/Berlin.`,
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await saveZoneSchedule(zone.id, {
        presence: "HOME",
        dayType,
        blocks,
        timetableTypeId: schedule.timetableTypeId,
      });
      setSchedule(res.schedule);
      applyQuota(res.quota);
    } catch (err) {
      if (err instanceof ApiError && err.quota) {
        applyQuota(err.quota);
      }
      setError(err instanceof Error ? err.message : "Speichern fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  async function persistAway(power: "ON" | "OFF", tempC: number | null): Promise<void> {
    if (quota?.blocked) {
      setError(
        `Cloud-Tageslimit erreicht (${quota?.used}/${quota?.limit}). Speichern blockiert.`,
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await saveZoneSchedule(zone.id, {
        presence: "AWAY",
        away: { power, tempC },
      });
      setSchedule(res.schedule);
      applyQuota(res.quota);
    } catch (err) {
      if (err instanceof ApiError && err.quota) {
        applyQuota(err.quota);
      }
      setError(err instanceof Error ? err.message : "Away speichern fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  function updateBlockTemp(dayType: ScheduleDayType, index: number, delta: number): void {
    if (!schedule) {
      return;
    }
    const current = blocksForDay(schedule, dayType);
    const next = current.map((b, i) => (i === index ? nudgeTemp(b, delta) : b));
    void persistHomeDay(dayType, next);
  }

  function addBlock(dayType: ScheduleDayType): void {
    if (!schedule) {
      return;
    }
    const current = blocksForDay(schedule, dayType);
    if (current.length === 0) {
      void persistHomeDay(dayType, [
        {
          dayType,
          start: "00:00",
          end: "00:00",
          power: "ON",
          tempC: 18,
        },
      ]);
      return;
    }
    // Split last block at midpoint — keeps full-day coverage for Tado API.
    const last = current[current.length - 1];
    const startM = minutesOf(last.start);
    let endM = minutesOf(last.end);
    if (endM <= startM) {
      endM = 24 * 60;
    }
    const mid = startM + Math.floor((endM - startM) / 2);
    if (mid - startM < 15 || endM - mid < 15) {
      setError("Zeitblock zu kurz zum Teilen (min. 15 Min).");
      return;
    }
    const hh = (m: number): string => {
      if (m >= 24 * 60) {
        return "00:00";
      }
      const h = Math.floor(m / 60);
      const min = m % 60;
      return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
    };
    const next: ScheduleBlock[] = [
      ...current.slice(0, -1),
      { ...last, end: hh(mid) },
      {
        dayType,
        start: hh(mid),
        end: last.end,
        power: "ON",
        tempC: 20,
      },
    ];
    void persistHomeDay(dayType, next);
  }

  const awayTemp =
    schedule && schedule.away.power !== "OFF" && schedule.away.tempC != null
      ? schedule.away.tempC
      : null;

  return (
    <div className="schedule">
      <header className="schedule__bar">
        <button type="button" className="icon-btn-ghost" onClick={onBack} aria-label="Zurück">
          <BackIcon />
        </button>
        <h1>{zone.name}</h1>
        <CloudQuotaBadge quota={quota} compact />
      </header>

      <h2 className="schedule__heading">Intelligenter Zeitplan</h2>
      <p className="schedule__note">
        Änderungen werden in die Tado-Cloud geschrieben und erscheinen in der offiziellen App.
        Ist/Soll bleibt lokal (HomeKit).
      </p>

      <div className="schedule__toolbar">
        <button
          type="button"
          className="schedule__sync"
          disabled={busy || quota?.blocked}
          onClick={() => void syncNow()}
        >
          {busy ? "…" : "Jetzt synchronisieren"}
        </button>
        <CloudQuotaBadge quota={quota} />
      </div>

      {error ? (
        <p className="error-state" role="alert">
          {error}
        </p>
      ) : null}

      <div className="schedule__toggle" role="group" aria-label="Home oder Away">
        <button
          type="button"
          className={presence === "HOME" ? "is-active" : undefined}
          onClick={() => setPresence("HOME")}
        >
          Home
        </button>
        <button
          type="button"
          className={presence === "AWAY" ? "is-active" : undefined}
          onClick={() => setPresence("AWAY")}
        >
          Away
        </button>
      </div>

      {presence === "HOME" ? (
        <>
          <button type="button" className="schedule__days-row" disabled>
            <span>Wochentage</span>
            <span className="schedule__days-meta">
              {meta.daysLabel} <ChevronIcon />
            </span>
          </button>

          {!schedule && busy ? <p className="schedule__note">Lade Zeitplan …</p> : null}

          <ul className="schedule__days">
            {dayTypes.map((dayType) => {
              const blocks = schedule ? blocksForDay(schedule, dayType) : [];
              const open = expanded[dayType] !== false;
              return (
                <li key={dayType} className="schedule__day-card">
                  <header>
                    <button
                      type="button"
                      className="schedule__day-toggle"
                      onClick={() =>
                        setExpanded((prev) => ({
                          ...prev,
                          [dayType]: !open,
                        }))
                      }
                    >
                      <span>{DAY_LABELS[dayType]}</span>
                      <span aria-hidden="true">{open ? "▾" : "▸"}</span>
                    </button>
                  </header>
                  {open ? (
                    <>
                      <div className="schedule__bar-24" aria-hidden="true">
                        {blocks.length === 0 ? (
                          <span className="is-cool" style={{ flex: 1 }}>
                            —
                          </span>
                        ) : (
                          blocks.map((b, i) => (
                            <button
                              key={`${dayType}-${b.start}-${i}`}
                              type="button"
                              className={
                                b.power === "OFF" || (b.tempC ?? 0) < 19
                                  ? "is-cool"
                                  : "is-warm"
                              }
                              style={{ flex: blockFlex(b) }}
                              disabled={busy || quota?.blocked}
                              onClick={() =>
                                setEditing({ dayType, index: i })
                              }
                            >
                              {displayTemp(b)}
                            </button>
                          ))
                        )}
                      </div>
                      <div className="schedule__axis">
                        <span>0:00</span>
                        <span>8:00</span>
                        <span>16:00</span>
                        <span>24:00</span>
                      </div>
                      {editing?.dayType === dayType ? (
                        <div className="schedule__edit-row">
                          <span>
                            {blocks[editing.index]
                              ? `${blocks[editing.index].start}–${blocks[editing.index].end === "00:00" ? "24:00" : blocks[editing.index].end}`
                              : ""}
                          </span>
                          <button
                            type="button"
                            className="schedule__chip"
                            disabled={busy || quota?.blocked}
                            onClick={() =>
                              updateBlockTemp(dayType, editing.index, -0.5)
                            }
                          >
                            −0,5°
                          </button>
                          <button
                            type="button"
                            className="schedule__chip"
                            disabled={busy || quota?.blocked}
                            onClick={() =>
                              updateBlockTemp(dayType, editing.index, 0.5)
                            }
                          >
                            +0,5°
                          </button>
                          <button
                            type="button"
                            className="schedule__chip"
                            onClick={() => setEditing(null)}
                          >
                            Fertig
                          </button>
                        </div>
                      ) : null}
                      <footer>
                        <span className="schedule__stub-actions">
                          {schedule?.fetchedAt
                            ? `Stand ${new Date(schedule.fetchedAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`
                            : ""}
                        </span>
                        <button
                          type="button"
                          className="schedule__add"
                          disabled={busy || quota?.blocked || !schedule}
                          onClick={() => addBlock(dayType)}
                        >
                          Zeitblock hinzufügen
                        </button>
                      </footer>
                    </>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <ul className="schedule__days">
          {schedule ? (
            <li className="schedule__day-card">
              <header>
                <span>Away-Solltemperatur</span>
              </header>
              <div className="schedule__bar-24" aria-hidden="true">
                <span
                  className={awayTemp != null && awayTemp >= 19 ? "is-warm" : "is-cool"}
                  style={{ flex: 1 }}
                >
                  {schedule.away.power === "OFF"
                    ? "Aus"
                    : `${(awayTemp ?? 5).toFixed(1)}°`}
                </span>
              </div>
              <div className="schedule__axis">
                <span>0:00</span>
                <span>24:00</span>
              </div>
              <footer className="schedule__edit-row">
                <button
                  type="button"
                  className="schedule__chip"
                  disabled={busy || quota?.blocked}
                  onClick={() =>
                    void persistAway(
                      "ON",
                      Math.max(5, (schedule.away.tempC ?? 16) - 0.5),
                    )
                  }
                >
                  −0,5°
                </button>
                <button
                  type="button"
                  className="schedule__chip"
                  disabled={busy || quota?.blocked}
                  onClick={() =>
                    void persistAway(
                      "ON",
                      Math.min(25, (schedule.away.tempC ?? 16) + 0.5),
                    )
                  }
                >
                  +0,5°
                </button>
                <button
                  type="button"
                  className="schedule__chip"
                  disabled={busy || quota?.blocked}
                  onClick={() => void persistAway("OFF", null)}
                >
                  Aus
                </button>
              </footer>
              <p className="schedule__away-note">
                Tado-API: Away ist ein fester Soll (kein Tagesplan). Home-Blöcke gelten nur
                im Home-Modus.
              </p>
            </li>
          ) : (
            <li className="schedule__note">
              {busy ? "Lade …" : "Kein Zeitplan geladen."}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
