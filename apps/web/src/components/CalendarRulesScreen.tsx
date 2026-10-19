/**
 * Calendar rules editor — pattern / event-UID → rooms/temp.
 * Priority: CalendarOverride > Overlay > Cloud baseline (HAP overlay preferred).
 *
 * @package @heizplan/web
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CalendarApplyPath,
  CalendarEventPreview,
  CalendarMatchKind,
  CalendarRule,
  CalendarRuleMode,
  CalendarStatusResponse,
  CloudQuotaStatus,
  Zone,
} from "@heizplan/shared";
import {
  ApiError,
  createCalendarRule,
  deleteCalendarRule,
  evaluateCalendarRules,
  fetchCalendarEvents,
  fetchCalendarStatus,
  saveCalendarEventSelection,
  updateCalendarRule,
} from "../api";
import { CloudQuotaBadge } from "./CloudQuotaBadge";
import { BackIcon } from "./icons";
import { CalendarConnectionPanel } from "./CalendarConnectionPanel";

interface CalendarRulesScreenProps {
  zones: Zone[];
  onBack: () => void;
  onQuotaChange?: (quota: CloudQuotaStatus) => void;
  focusRoomId?: string | null;
}

interface Draft {
  name: string;
  matchKind: CalendarMatchKind;
  matchValue: string;
  calendarId: string;
  roomIds: string[];
  mode: CalendarRuleMode;
  targetTempC: string;
  applyPath: CalendarApplyPath;
  priority: string;
  enabled: boolean;
}

function emptyDraft(focusRoomId?: string | null): Draft {
  return {
    name: "",
    matchKind: "title_contains",
    matchValue: "Büro",
    calendarId: "",
    roomIds: focusRoomId ? [focusRoomId] : [],
    mode: "heat",
    targetTempC: "20",
    applyPath: "hap_overlay",
    priority: "100",
    enabled: true,
  };
}

function draftFromRule(rule: CalendarRule): Draft {
  return {
    name: rule.name,
    matchKind: rule.match.kind,
    matchValue: rule.match.value,
    calendarId: rule.calendarId ?? "",
    roomIds: [...rule.roomIds],
    mode: rule.mode,
    targetTempC: rule.targetTempC != null ? String(rule.targetTempC) : "20",
    applyPath: rule.applyPath,
    priority: String(rule.priority),
    enabled: rule.enabled,
  };
}

function toPayload(draft: Draft): Partial<CalendarRule> {
  return {
    name: draft.name.trim() || draft.matchValue.trim(),
    enabled: draft.enabled,
    calendarId: draft.calendarId || null,
    match: { kind: draft.matchKind, value: draft.matchValue.trim() },
    roomIds: draft.roomIds,
    mode: draft.mode,
    targetTempC: draft.mode === "off" ? null : Number(draft.targetTempC),
    applyPath: draft.applyPath,
    priority: Number(draft.priority) || 100,
  };
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString("de-DE", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function CalendarRulesScreen({
  zones,
  onBack,
  onQuotaChange,
  focusRoomId,
}: CalendarRulesScreenProps) {
  const [status, setStatus] = useState<CalendarStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Only true during mutating actions — does NOT disable Neue Regel / Events prüfen. */
  const [actionBusy, setActionBusy] = useState(false);
  const [eventsBusy, setEventsBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(focusRoomId));
  const [evalMsg, setEvalMsg] = useState<string | null>(null);
  const [events, setEvents] = useState<CalendarEventPreview[]>([]);
  const [selectedUids, setSelectedUids] = useState<string[]>([]);
  const [eventsFetchedAt, setEventsFetchedAt] = useState<string | null>(null);
  const [selectionHint, setSelectionHint] = useState<string | null>(null);
  const onQuotaChangeRef = useRef(onQuotaChange);
  onQuotaChangeRef.current = onQuotaChange;

  const refreshStatus = useCallback(async () => {
    try {
      const s = await fetchCalendarStatus();
      setStatus(s);
      setSelectedUids(s.selectedUids ?? []);
      onQuotaChangeRef.current?.(s.quota);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kalenderstatus laden fehlgeschlagen");
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const loadEvents = useCallback(async () => {
    setEventsBusy(true);
    setError(null);
    try {
      const res = await fetchCalendarEvents();
      setEvents(res.events);
      setSelectedUids(res.selectedUids);
      setEventsFetchedAt(res.fetchedAt);
      setSelectionHint(
        res.selectionActive
          ? `${res.selectedUids.length} Event(s) ausgewählt — nur diese werden ausgewertet.`
          : "Keine Auswahl — Muster-Regeln gelten für alle geladenen Events.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Events laden fehlgeschlagen");
    } finally {
      setEventsBusy(false);
    }
  }, []);

  async function persistSelection(next: string[]): Promise<void> {
    setEventsBusy(true);
    setError(null);
    try {
      const res = await saveCalendarEventSelection(next);
      setEvents(res.events);
      setSelectedUids(res.selectedUids);
      setEventsFetchedAt(res.fetchedAt);
      setSelectionHint(
        res.selectionActive
          ? `${res.selectedUids.length} Event(s) gespeichert — Evaluate nutzt nur diese.`
          : "Auswahl geleert — wieder alle Events (Muster-Regeln).",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Auswahl speichern fehlgeschlagen");
    } finally {
      setEventsBusy(false);
    }
  }

  function toggleEventUid(uid: string): void {
    const next = selectedUids.includes(uid)
      ? selectedUids.filter((id) => id !== uid)
      : [...selectedUids, uid];
    void persistSelection(next);
  }

  function ruleFromEvent(ev: CalendarEventPreview): void {
    setCreating(true);
    setEditingId(null);
    setDraft({
      ...emptyDraft(focusRoomId),
      name: ev.summary,
      matchKind: "event_uid",
      matchValue: ev.uid,
      calendarId: ev.calendarId,
    });
    if (!selectedUids.includes(ev.uid)) {
      void persistSelection([...selectedUids, ev.uid]);
    }
  }

  function toggleRoom(roomId: string): void {
    setDraft((d) => ({
      ...d,
      roomIds: d.roomIds.includes(roomId)
        ? d.roomIds.filter((id) => id !== roomId)
        : [...d.roomIds, roomId],
    }));
  }

  async function saveDraft(): Promise<void> {
    setActionBusy(true);
    setError(null);
    try {
      const payload = toPayload(draft);
      if (editingId) {
        await updateCalendarRule(editingId, payload);
      } else {
        await createCalendarRule(payload);
      }
      setCreating(false);
      setEditingId(null);
      setDraft(emptyDraft(focusRoomId));
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Regel speichern fehlgeschlagen");
    } finally {
      setActionBusy(false);
    }
  }

  async function remove(id: string): Promise<void> {
    setActionBusy(true);
    setError(null);
    try {
      await deleteCalendarRule(id);
      if (editingId === id) {
        setEditingId(null);
        setCreating(false);
      }
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Löschen fehlgeschlagen");
    } finally {
      setActionBusy(false);
    }
  }

  async function runEvaluate(): Promise<void> {
    setActionBusy(true);
    setError(null);
    setEvalMsg(null);
    try {
      const result = await evaluateCalendarRules();
      onQuotaChangeRef.current?.(result.quota);
      setEvalMsg(result.message);
      await refreshStatus();
    } catch (err) {
      if (err instanceof ApiError && err.quota) {
        onQuotaChangeRef.current?.(err.quota);
      }
      setError(err instanceof Error ? err.message : "Auswerten fehlgeschlagen");
    } finally {
      setActionBusy(false);
    }
  }

  const rules = status?.rules ?? [];
  const active = status?.active ?? [];
  const calendars = status?.connection.calendars ?? [];
  const configured = Boolean(status?.connection.configured);
  /** Primary actions stay clickable during background refresh. */
  const primaryDisabled = actionBusy;

  return (
    <div className="calendar-rules">
      <header className="schedule__bar">
        <button type="button" className="icon-btn-ghost" onClick={onBack} aria-label="Zurück">
          <BackIcon />
        </button>
        <h1>Kalenderregeln</h1>
        <CloudQuotaBadge quota={status?.quota ?? null} compact />
      </header>
      <p className="schedule__note">
        Events auswählen und/oder Muster-Regeln — überschreibt den Tado-Zeitplan (über Overlay &amp;
        Cloud-Baseline).
      </p>

      <section className="calendar-rules__section">
        <h2 className="calendar-rules__h">iCloud / CalDAV</h2>
        <CalendarConnectionPanel
          onChanged={() => {
            void refreshStatus();
          }}
        />
      </section>

      <section className="calendar-rules__section">
        <div className="calendar-rules__row-head">
          <h2 className="calendar-rules__h">Kommende Events</h2>
          <button
            type="button"
            className="settings-quota-save"
            disabled={eventsBusy || !configured}
            onClick={() => void loadEvents()}
          >
            {eventsBusy ? "Laden…" : "Events laden"}
          </button>
        </div>
        <p className="settings__hint">
          Haken = Event wird bei „Events prüfen“ berücksichtigt. Ohne Haken gelten nur
          Muster-Regeln auf alle Events. „Regel daraus“ bindet fest an die Event-UID.
        </p>
        {selectionHint ? (
          <p className="settings-row__meta" role="status">
            {selectionHint}
          </p>
        ) : null}
        {eventsFetchedAt ? (
          <p className="settings-row__meta">
            Stand {new Date(eventsFetchedAt).toLocaleString("de-DE")}
            {selectedUids.length > 0 ? ` · ${selectedUids.length} ausgewählt` : ""}
          </p>
        ) : (
          <p className="settings-row__meta">Noch nicht geladen — „Events laden“ tippen.</p>
        )}
        {events.length > 0 ? (
          <ul className="calendar-rules__list calendar-rules__events">
            {events.map((ev) => {
              const checked = selectedUids.includes(ev.uid);
              return (
                <li key={ev.uid} className="calendar-rules__card calendar-rules__event">
                  <label className="calendar-rules__event-check">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={eventsBusy}
                      onChange={() => toggleEventUid(ev.uid)}
                    />
                    <span className="calendar-rules__event-body">
                      <strong>{ev.summary}</strong>
                      <span className="settings-row__meta">
                        {formatWhen(ev.startsAt)} – {formatWhen(ev.endsAt)} · {ev.calendarName}
                      </span>
                    </span>
                  </label>
                  <button
                    type="button"
                    className="calendar-conn__secondary"
                    disabled={actionBusy}
                    onClick={() => ruleFromEvent(ev)}
                  >
                    Regel daraus
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
        {selectedUids.length > 0 ? (
          <button
            type="button"
            className="calendar-conn__secondary"
            disabled={eventsBusy}
            onClick={() => void persistSelection([])}
          >
            Auswahl leeren
          </button>
        ) : null}
      </section>

      <section className="calendar-rules__section">
        <div className="calendar-rules__row-head">
          <h2 className="calendar-rules__h">Regeln</h2>
          <button
            type="button"
            className="settings-quota-save"
            disabled={primaryDisabled}
            onClick={() => {
              setCreating(true);
              setEditingId(null);
              setDraft(emptyDraft(focusRoomId));
            }}
          >
            Neue Regel
          </button>
        </div>
        <p className="settings__hint">
          Priorität: <strong>Kalender</strong> &gt; manuelles Overlay &gt; Cloud-Zeitplan. Standard:
          HAP-Overlay (0 Cloud).
        </p>

        {rules.length === 0 && !creating ? (
          <p className="settings-row__meta">
            Noch keine Regeln — Event anhaken + „Regel daraus“, oder Muster „Büro“.
          </p>
        ) : null}

        <ul className="calendar-rules__list">
          {rules.map((rule) => (
            <li key={rule.id} className="calendar-rules__card">
              <div className="calendar-rules__card-main">
                <strong>{rule.name}</strong>
                <span className="settings-row__meta">
                  {rule.enabled ? "an" : "aus"} · {rule.match.kind} „
                  {rule.match.kind === "event_uid"
                    ? `${rule.match.value.slice(0, 12)}…`
                    : rule.match.value}
                  “ →{" "}
                  {rule.roomIds
                    .map((id) => zones.find((z) => z.id === id)?.name ?? id)
                    .join(", ")}{" "}
                  ·{" "}
                  {rule.mode === "off"
                    ? "Aus"
                    : `${rule.targetTempC?.toFixed(1) ?? "—"}°`}{" "}
                  · {rule.applyPath === "hap_overlay" ? "HAP" : "Cloud"}
                </span>
              </div>
              <div className="calendar-rules__card-actions">
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={() => {
                    setEditingId(rule.id);
                    setCreating(true);
                    setDraft(draftFromRule(rule));
                  }}
                >
                  Bearbeiten
                </button>
                <button type="button" disabled={actionBusy} onClick={() => void remove(rule.id)}>
                  Löschen
                </button>
              </div>
            </li>
          ))}
        </ul>

        {creating ? (
          <form
            className="calendar-rules__form"
            onSubmit={(e) => {
              e.preventDefault();
              void saveDraft();
            }}
          >
            <h3>{editingId ? "Regel bearbeiten" : "Neue Regel"}</h3>
            <label className="calendar-conn__field">
              <span>Name</span>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Büro-Heizung"
              />
            </label>
            <label className="calendar-conn__field">
              <span>Match</span>
              <select
                value={draft.matchKind}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    matchKind: e.target.value as CalendarMatchKind,
                  })
                }
              >
                <option value="title_contains">Titel enthält</option>
                <option value="title_equals">Titel gleich</option>
                <option value="title_regex">Titel Regex</option>
                <option value="event_uid">Event-UID (Picker)</option>
              </select>
            </label>
            <label className="calendar-conn__field">
              <span>{draft.matchKind === "event_uid" ? "Event-UID" : "Muster"}</span>
              <input
                value={draft.matchValue}
                onChange={(e) => setDraft({ ...draft, matchValue: e.target.value })}
                required
                placeholder={draft.matchKind === "event_uid" ? "UID aus Picker" : "Büro"}
              />
            </label>
            <label className="calendar-conn__field">
              <span>Kalender</span>
              <select
                value={draft.calendarId}
                onChange={(e) => setDraft({ ...draft, calendarId: e.target.value })}
              >
                <option value="">Alle Kalender</option>
                {calendars.map((cal) => (
                  <option key={cal.id} value={cal.id}>
                    {cal.displayName}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="calendar-rules__rooms">
              <legend>Räume</legend>
              {zones.map((z) => (
                <label key={z.id} className="calendar-rules__room">
                  <input
                    type="checkbox"
                    checked={draft.roomIds.includes(z.id)}
                    onChange={() => toggleRoom(z.id)}
                  />
                  {z.name}
                </label>
              ))}
            </fieldset>
            <label className="calendar-conn__field">
              <span>Modus</span>
              <select
                value={draft.mode}
                onChange={(e) =>
                  setDraft({ ...draft, mode: e.target.value as CalendarRuleMode })
                }
              >
                <option value="heat">Heizen</option>
                <option value="eco">Eco</option>
                <option value="off">Aus</option>
              </select>
            </label>
            {draft.mode !== "off" ? (
              <label className="calendar-conn__field">
                <span>Soll °C</span>
                <input
                  type="number"
                  min={5}
                  max={30}
                  step={0.5}
                  value={draft.targetTempC}
                  onChange={(e) => setDraft({ ...draft, targetTempC: e.target.value })}
                />
              </label>
            ) : null}
            <label className="calendar-conn__field">
              <span>Anwenden über</span>
              <select
                value={draft.applyPath}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    applyPath: e.target.value as CalendarApplyPath,
                  })
                }
              >
                <option value="hap_overlay">HAP-Overlay (empfohlen, 0 Cloud)</option>
                <option value="cloud_write">Cloud (nur wenn Quota übrig)</option>
              </select>
            </label>
            <label className="calendar-conn__field">
              <span>Priorität</span>
              <input
                type="number"
                value={draft.priority}
                onChange={(e) => setDraft({ ...draft, priority: e.target.value })}
              />
            </label>
            <label className="settings-row settings-row--toggle">
              <span className="settings-row__label">Aktiv</span>
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
              />
            </label>
            <div className="calendar-conn__actions">
              <button type="submit" className="settings-quota-save" disabled={actionBusy}>
                Speichern
              </button>
              <button
                type="button"
                className="calendar-conn__secondary"
                disabled={actionBusy}
                onClick={() => {
                  setCreating(false);
                  setEditingId(null);
                }}
              >
                Abbrechen
              </button>
            </div>
          </form>
        ) : null}
      </section>

      <section className="calendar-rules__section">
        <div className="calendar-rules__row-head">
          <h2 className="calendar-rules__h">Jetzt auswerten</h2>
          <button
            type="button"
            className="settings-quota-save"
            disabled={primaryDisabled || !configured}
            onClick={() => void runEvaluate()}
          >
            {actionBusy ? "Prüfe…" : "Events prüfen"}
          </button>
        </div>
        {evalMsg ? (
          <p className="settings__hint" role="status">
            {evalMsg}
          </p>
        ) : null}
        {active.length > 0 ? (
          <ul className="calendar-rules__list">
            {active.map((a) => (
              <li key={`${a.roomId}-${a.eventUid}`} className="calendar-rules__card">
                <strong>{a.eventSummary}</strong>
                <span className="settings-row__meta">
                  {zones.find((z) => z.id === a.roomId)?.name ?? a.roomId} · bis{" "}
                  {new Date(a.endsAt).toLocaleString("de-DE")} · {a.applyPath}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="settings-row__meta">Kein aktiver Kalender-Override.</p>
        )}
      </section>

      {error ? (
        <p className="error-state" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
