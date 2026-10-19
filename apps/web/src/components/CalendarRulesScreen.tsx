/**
 * Calendar rules editor — pattern → rooms/temp, next to Smart Schedule.
 * Priority: CalendarOverride > Overlay > Cloud baseline (HAP overlay preferred).
 *
 * @package @heizplan/web
 */

import { useCallback, useEffect, useState } from "react";
import type {
  CalendarApplyPath,
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
  fetchCalendarStatus,
  updateCalendarRule,
} from "../api";
import { CloudQuotaBadge } from "./CloudQuotaBadge";
import { BackIcon } from "./icons";
import { CalendarConnectionPanel } from "./CalendarConnectionPanel";

interface CalendarRulesScreenProps {
  zones: Zone[];
  onBack: () => void;
  onQuotaChange?: (quota: CloudQuotaStatus) => void;
  /** When opened from a room schedule, pre-select that room in new rules. */
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
    targetTempC:
      draft.mode === "off"
        ? null
        : Number(draft.targetTempC),
    applyPath: draft.applyPath,
    priority: Number(draft.priority) || 100,
  };
}

export function CalendarRulesScreen({
  zones,
  onBack,
  onQuotaChange,
  focusRoomId,
}: CalendarRulesScreenProps) {
  const [status, setStatus] = useState<CalendarStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(focusRoomId));
  const [evalMsg, setEvalMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const s = await fetchCalendarStatus();
      setStatus(s);
      onQuotaChange?.(s.quota);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kalenderstatus laden fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }, [onQuotaChange]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleRoom(roomId: string): void {
    setDraft((d) => ({
      ...d,
      roomIds: d.roomIds.includes(roomId)
        ? d.roomIds.filter((id) => id !== roomId)
        : [...d.roomIds, roomId],
    }));
  }

  async function saveDraft(): Promise<void> {
    setBusy(true);
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
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Regel speichern fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await deleteCalendarRule(id);
      if (editingId === id) {
        setEditingId(null);
        setCreating(false);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Löschen fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  async function runEvaluate(): Promise<void> {
    setBusy(true);
    setError(null);
    setEvalMsg(null);
    try {
      const result = await evaluateCalendarRules();
      onQuotaChange?.(result.quota);
      setEvalMsg(result.message);
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.quota) {
        onQuotaChange?.(err.quota);
      }
      setError(err instanceof Error ? err.message : "Auswerten fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  const rules = status?.rules ?? [];
  const active = status?.active ?? [];
  const calendars = status?.connection.calendars ?? [];

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
        Event-Match überschreibt den Tado-Zeitplan (Priorität über Overlay &amp; Cloud-Baseline).
      </p>

      <section className="calendar-rules__section">
        <h2 className="calendar-rules__h">iCloud / CalDAV</h2>
        <CalendarConnectionPanel
          onChanged={() => {
            void load();
          }}
        />
      </section>

      <section className="calendar-rules__section">
        <div className="calendar-rules__row-head">
          <h2 className="calendar-rules__h">Regeln</h2>
          <button
            type="button"
            className="settings-quota-save"
            disabled={busy}
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
          Priorität: <strong>Kalender</strong> &gt; manuelles Overlay &gt; Cloud-Zeitplan.
          Standard: lokales HAP-Overlay (0 Cloud-Requests). Cloud-Writes nur wenn nötig und Quota
          übrig.
        </p>

        {rules.length === 0 && !creating ? (
          <p className="settings-row__meta">Noch keine Regeln — z. B. Titel enthält „Büro“.</p>
        ) : null}

        <ul className="calendar-rules__list">
          {rules.map((rule) => (
            <li key={rule.id} className="calendar-rules__card">
              <div className="calendar-rules__card-main">
                <strong>{rule.name}</strong>
                <span className="settings-row__meta">
                  {rule.enabled ? "an" : "aus"} · {rule.match.kind} „{rule.match.value}“ →{" "}
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
                  disabled={busy}
                  onClick={() => {
                    setEditingId(rule.id);
                    setCreating(true);
                    setDraft(draftFromRule(rule));
                  }}
                >
                  Bearbeiten
                </button>
                <button type="button" disabled={busy} onClick={() => void remove(rule.id)}>
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
              </select>
            </label>
            <label className="calendar-conn__field">
              <span>Muster</span>
              <input
                value={draft.matchValue}
                onChange={(e) => setDraft({ ...draft, matchValue: e.target.value })}
                required
                placeholder="Büro"
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
              <button type="submit" className="settings-quota-save" disabled={busy}>
                Speichern
              </button>
              <button
                type="button"
                className="calendar-conn__secondary"
                disabled={busy}
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
            disabled={busy || !status?.connection.configured}
            onClick={() => void runEvaluate()}
          >
            Events prüfen
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
