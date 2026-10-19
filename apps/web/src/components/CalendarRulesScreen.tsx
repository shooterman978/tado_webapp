/**
 * Calendar rules — guided wizard for non-technical users.
 * Everyday German; expert options under „Erweitert“. API/engine unchanged.
 *
 * @package @heizplan/web
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CalendarEventPreview,
  CalendarRule,
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
  saveCalendarConnection,
  saveCalendarEventSelection,
} from "../api";
import { BackIcon } from "./icons";
import { CalendarConnectionPanel } from "./CalendarConnectionPanel";

interface CalendarRulesScreenProps {
  zones: Zone[];
  onBack: () => void;
  onQuotaChange?: (quota: CloudQuotaStatus) => void;
  focusRoomId?: string | null;
}

type WizardStep =
  | "overview"
  | "connect"
  | "events"
  | "setup"
  | "done"
  | "advanced";

const TEMP_PRESETS = [18, 19, 20, 21, 22] as const;

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

function rulePlainSummary(rule: CalendarRule, zones: Zone[]): string {
  const rooms = rule.roomIds
    .map((id) => zones.find((z) => z.id === id)?.name ?? id)
    .join(", ");
  const temp =
    rule.mode === "off"
      ? "Aus"
      : `${rule.targetTempC?.toFixed(0) ?? "—"}°`;
  const when =
    rule.match.kind === "event_uid"
      ? rule.name
      : `wenn „${rule.match.value}“ im Titel`;
  return `${when} → ${rooms || "kein Raum"} auf ${temp}`;
}

export function CalendarRulesScreen({
  zones,
  onBack,
  onQuotaChange,
  focusRoomId,
}: CalendarRulesScreenProps) {
  const [step, setStep] = useState<WizardStep>("overview");
  const [status, setStatus] = useState<CalendarStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [eventsBusy, setEventsBusy] = useState(false);
  const [events, setEvents] = useState<CalendarEventPreview[]>([]);
  const [picked, setPicked] = useState<CalendarEventPreview | null>(null);
  const [roomIds, setRoomIds] = useState<string[]>(
    focusRoomId ? [focusRoomId] : [],
  );
  const [tempC, setTempC] = useState(20);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);
  const [connectUser, setConnectUser] = useState("");
  const [connectPass, setConnectPass] = useState("");
  const onQuotaRef = useRef(onQuotaChange);
  onQuotaRef.current = onQuotaChange;

  const refreshStatus = useCallback(async () => {
    try {
      const s = await fetchCalendarStatus();
      setStatus(s);
      onQuotaRef.current?.(s.quota);
      if (s.connection.username) {
        setConnectUser(s.connection.username);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Status konnte nicht geladen werden",
      );
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const configured = Boolean(status?.connection.configured);
  const rules = status?.rules ?? [];

  function startNewRule(): void {
    setError(null);
    setPicked(null);
    setDoneMsg(null);
    setRoomIds(focusRoomId ? [focusRoomId] : []);
    setTempC(20);
    setStep(configured ? "events" : "connect");
    if (configured) {
      void loadEvents();
    }
  }

  async function loadEvents(): Promise<void> {
    setEventsBusy(true);
    setError(null);
    try {
      const res = await fetchCalendarEvents();
      setEvents(res.events);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Termine konnten nicht geladen werden",
      );
    } finally {
      setEventsBusy(false);
    }
  }

  async function saveSimpleConnect(): Promise<void> {
    setActionBusy(true);
    setError(null);
    try {
      await saveCalendarConnection({
        url: "https://caldav.icloud.com",
        username: connectUser.trim(),
        appPassword: connectPass.trim() || undefined,
      });
      setConnectPass("");
      await refreshStatus();
      setStep("events");
      await loadEvents();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Verbindung fehlgeschlagen — App-Passwort prüfen",
      );
    } finally {
      setActionBusy(false);
    }
  }

  function pickEvent(ev: CalendarEventPreview): void {
    setPicked(ev);
    setStep("setup");
  }

  function toggleRoom(id: string): void {
    setRoomIds((prev) =>
      prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id],
    );
  }

  async function finishRule(): Promise<void> {
    if (!picked) {
      return;
    }
    if (roomIds.length === 0) {
      setError("Bitte mindestens einen Raum auswählen.");
      return;
    }
    setActionBusy(true);
    setError(null);
    try {
      const selected = Array.from(
        new Set([...(status?.selectedUids ?? []), picked.uid]),
      );
      await saveCalendarEventSelection(selected);
      await createCalendarRule({
        name: picked.summary,
        enabled: true,
        calendarId: picked.calendarId,
        match: { kind: "event_uid", value: picked.uid },
        roomIds,
        mode: "heat",
        targetTempC: tempC,
        applyPath: "hap_overlay",
        priority: 200,
      });
      try {
        const result = await evaluateCalendarRules();
        onQuotaRef.current?.(result.quota);
        setDoneMsg(
          result.applied > 0 || result.matched > 0
            ? "Alles eingerichtet. Wenn der Termin läuft, wird geheizt."
            : "Gespeichert. Sobald der Termin beginnt, wird geheizt.",
        );
      } catch (err) {
        if (err instanceof ApiError && err.quota) {
          onQuotaRef.current?.(err.quota);
        }
        setDoneMsg(
          "Regel gespeichert. Aktivierung folgt automatisch oder über „Jetzt prüfen“.",
        );
      }
      await refreshStatus();
      setStep("done");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Speichern fehlgeschlagen",
      );
    } finally {
      setActionBusy(false);
    }
  }

  async function removeRule(id: string): Promise<void> {
    setActionBusy(true);
    setError(null);
    try {
      await deleteCalendarRule(id);
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Löschen fehlgeschlagen");
    } finally {
      setActionBusy(false);
    }
  }

  async function runCheck(): Promise<void> {
    setActionBusy(true);
    setError(null);
    try {
      const result = await evaluateCalendarRules();
      onQuotaRef.current?.(result.quota);
      setDoneMsg(result.message || "Geprüft.");
      await refreshStatus();
    } catch (err) {
      if (err instanceof ApiError && err.quota) {
        onQuotaRef.current?.(err.quota);
      }
      setError(err instanceof Error ? err.message : "Prüfen fehlgeschlagen");
    } finally {
      setActionBusy(false);
    }
  }

  function stepBack(): void {
    setError(null);
    if (step === "connect" || step === "advanced") {
      setStep("overview");
      return;
    }
    if (step === "events") {
      setStep(configured ? "overview" : "connect");
      return;
    }
    if (step === "setup") {
      setStep("events");
      return;
    }
    if (step === "done") {
      setStep("overview");
      return;
    }
    onBack();
  }

  const headerTitle =
    step === "overview"
      ? "Termine & Heizung"
      : step === "connect"
        ? "iPhone-Kalender"
        : step === "events"
          ? "Termin wählen"
          : step === "setup"
            ? "Räume & Wärme"
            : step === "done"
              ? "Fertig"
              : "Erweitert";

  return (
    <div className="cal-wiz">
      <header className="schedule__bar">
        <button
          type="button"
          className="icon-btn-ghost"
          onClick={step === "overview" ? onBack : stepBack}
          aria-label={step === "overview" ? "Zurück" : "Vorheriger Schritt"}
        >
          <BackIcon />
        </button>
        <h1>{headerTitle}</h1>
        <span className="cal-wiz__step-pill" aria-hidden="true">
          {step === "overview"
            ? ""
            : step === "connect"
              ? "1/4"
              : step === "events"
                ? "2/4"
                : step === "setup"
                  ? "3/4"
                  : step === "done"
                    ? "4/4"
                    : ""}
        </span>
      </header>

      {error ? (
        <p className="error-state" role="alert">
          {error}
        </p>
      ) : null}

      {step === "overview" ? (
        <div className="cal-wiz__body">
          <p className="cal-wiz__lead">
            Wenn ein Termin im iPhone-Kalender läuft, kann die Heizung automatisch
            mitgehen — ganz ohne Technik-Einstellungen.
          </p>

          <button
            type="button"
            className="cal-wiz__primary"
            disabled={actionBusy}
            onClick={startNewRule}
          >
            Neue Regel anlegen
          </button>

          {!configured ? (
            <p className="cal-wiz__hint">
              Noch nicht mit dem iPhone-Kalender verbunden — der Assistent hilft
              Schritt für Schritt.
            </p>
          ) : (
            <p className="cal-wiz__hint">
              Kalender verbunden
              {status?.connection.username
                ? ` (${status.connection.username})`
                : ""}
              .
            </p>
          )}

          {rules.length > 0 ? (
            <>
              <h2 className="cal-wiz__h">Eure Regeln</h2>
              <ul className="cal-wiz__list">
                {rules.map((rule) => (
                  <li key={rule.id} className="cal-wiz__card">
                    <div>
                      <strong>{rule.name}</strong>
                      <span className="cal-wiz__meta">
                        {rulePlainSummary(rule, zones)}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="cal-wiz__ghost"
                      disabled={actionBusy}
                      onClick={() => void removeRule(rule.id)}
                    >
                      Entfernen
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="cal-wiz__secondary"
                disabled={actionBusy || !configured}
                onClick={() => void runCheck()}
              >
                Jetzt prüfen
              </button>
            </>
          ) : (
            <p className="cal-wiz__meta">Noch keine Regeln — tippe oben auf „Neue Regel anlegen“.</p>
          )}

          {(status?.active.length ?? 0) > 0 ? (
            <p className="cal-wiz__active" role="status">
              Gerade aktiv: {status!.active.map((a) => a.eventSummary).join(", ")}
            </p>
          ) : null}

          <button
            type="button"
            className="cal-wiz__link"
            onClick={() => setStep("advanced")}
          >
            Erweiterte Einstellungen
          </button>
        </div>
      ) : null}

      {step === "connect" ? (
        <div className="cal-wiz__body">
          <p className="cal-wiz__lead">
            Einmalig: Apple-ID und ein <strong>App-Passwort</strong> (nicht das
            normale iPhone-Passwort).
          </p>
          <ol className="cal-wiz__howto">
            <li>Auf dem iPhone: Einstellungen → [dein Name] → Anmeldung &amp; Sicherheit</li>
            <li>„App-Passwort“ erzeugen (Name z. B. Heizplan)</li>
            <li>Hier eintragen und weiter</li>
          </ol>
          <label className="cal-wiz__field">
            <span>Apple-ID (E-Mail)</span>
            <input
              type="email"
              value={connectUser}
              disabled={actionBusy}
              autoComplete="username"
              onChange={(e) => setConnectUser(e.target.value)}
              placeholder="name@icloud.com"
            />
          </label>
          <label className="cal-wiz__field">
            <span>App-Passwort</span>
            <input
              type="password"
              value={connectPass}
              disabled={actionBusy}
              autoComplete="new-password"
              onChange={(e) => setConnectPass(e.target.value)}
              placeholder="xxxx-xxxx-xxxx-xxxx"
            />
          </label>
          <div className="cal-wiz__nav">
            <button type="button" className="cal-wiz__ghost" onClick={stepBack}>
              Zurück
            </button>
            <button
              type="button"
              className="cal-wiz__primary"
              disabled={
                actionBusy ||
                !connectUser.trim() ||
                (!connectPass.trim() && !status?.connection.hasPassword)
              }
              onClick={() => void saveSimpleConnect()}
            >
              {actionBusy ? "Verbinde…" : "Weiter"}
            </button>
          </div>
        </div>
      ) : null}

      {step === "events" ? (
        <div className="cal-wiz__body">
          <p className="cal-wiz__lead">
            Welcher Termin soll die Heizung steuern? Einfach antippen.
          </p>
          <button
            type="button"
            className="cal-wiz__secondary"
            disabled={eventsBusy}
            onClick={() => void loadEvents()}
          >
            {eventsBusy ? "Lade Termine…" : "Termine aktualisieren"}
          </button>
          {events.length === 0 && !eventsBusy ? (
            <p className="cal-wiz__meta">
              Keine kommenden Termine gefunden. Lege einen Termin im iPhone-Kalender
              an und tippe auf „Termine aktualisieren“.
            </p>
          ) : null}
          <ul className="cal-wiz__list">
            {events.map((ev) => (
              <li key={ev.uid}>
                <button
                  type="button"
                  className="cal-wiz__event"
                  disabled={actionBusy || eventsBusy}
                  onClick={() => pickEvent(ev)}
                >
                  <strong>{ev.summary}</strong>
                  <span className="cal-wiz__meta">
                    {formatWhen(ev.startsAt)} – {formatWhen(ev.endsAt)}
                    {ev.calendarName ? ` · ${ev.calendarName}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="cal-wiz__nav">
            <button type="button" className="cal-wiz__ghost" onClick={stepBack}>
              Zurück
            </button>
          </div>
        </div>
      ) : null}

      {step === "setup" && picked ? (
        <div className="cal-wiz__body">
          <p className="cal-wiz__lead">
            Termin: <strong>{picked.summary}</strong>
            <br />
            <span className="cal-wiz__meta">
              {formatWhen(picked.startsAt)} – {formatWhen(picked.endsAt)}
            </span>
          </p>

          <h2 className="cal-wiz__h">Welche Räume heizen?</h2>
          <div className="cal-wiz__rooms">
            {zones.map((z) => {
              const on = roomIds.includes(z.id);
              return (
                <button
                  key={z.id}
                  type="button"
                  className={
                    on ? "cal-wiz__chip is-on" : "cal-wiz__chip"
                  }
                  onClick={() => toggleRoom(z.id)}
                >
                  {z.name}
                </button>
              );
            })}
          </div>

          <h2 className="cal-wiz__h">Wie warm?</h2>
          <div className="cal-wiz__temps">
            {TEMP_PRESETS.map((t) => (
              <button
                key={t}
                type="button"
                className={
                  tempC === t ? "cal-wiz__chip is-on" : "cal-wiz__chip"
                }
                onClick={() => setTempC(t)}
              >
                {t}°
              </button>
            ))}
          </div>
          <label className="cal-wiz__field">
            <span>Oder genau einstellen (°C)</span>
            <input
              type="number"
              min={5}
              max={30}
              step={0.5}
              value={tempC}
              onChange={(e) => setTempC(Number(e.target.value) || 20)}
            />
          </label>

          <div className="cal-wiz__nav">
            <button type="button" className="cal-wiz__ghost" onClick={stepBack}>
              Zurück
            </button>
            <button
              type="button"
              className="cal-wiz__primary"
              disabled={actionBusy || roomIds.length === 0}
              onClick={() => void finishRule()}
            >
              {actionBusy ? "Speichere…" : "Fertig"}
            </button>
          </div>
        </div>
      ) : null}

      {step === "done" ? (
        <div className="cal-wiz__body">
          <p className="cal-wiz__lead cal-wiz__lead--ok">
            {doneMsg ?? "Gespeichert."}
          </p>
          {picked ? (
            <p className="cal-wiz__meta">
              {picked.summary}:{" "}
              {roomIds
                .map((id) => zones.find((z) => z.id === id)?.name ?? id)
                .join(", ")}{" "}
              auf {tempC}°
            </p>
          ) : null}
          <button
            type="button"
            className="cal-wiz__primary"
            onClick={() => {
              setStep("overview");
              setPicked(null);
            }}
          >
            Zur Übersicht
          </button>
          <button
            type="button"
            className="cal-wiz__secondary"
            disabled={actionBusy}
            onClick={startNewRule}
          >
            Noch eine Regel
          </button>
        </div>
      ) : null}

      {step === "advanced" ? (
        <div className="cal-wiz__body">
          <p className="cal-wiz__hint">
            Für Technik-Interessierte. Im Alltag reicht der Assistent oben.
          </p>
          <CalendarConnectionPanel
            onChanged={() => {
              void refreshStatus();
            }}
          />
          <div className="cal-wiz__nav">
            <button
              type="button"
              className="cal-wiz__primary"
              onClick={() => setStep("overview")}
            >
              Zurück zur Übersicht
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
