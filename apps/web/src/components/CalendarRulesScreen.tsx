/**
 * Calendar rules — guided wizard (everyday German).
 * Supports future/pattern rules, multi-event select, heat+off rooms, timing.
 *
 * @package @heizplan/web
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CalendarEventPreview,
  CalendarRule,
  CalendarRuleTiming,
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
  | "how"
  | "events"
  | "pattern"
  | "name"
  | "rooms"
  | "done"
  | "advanced";

type HowKind = "events" | "pattern";

const TEMP_PRESETS = [18, 19, 20, 21, 22] as const;

const HEAT_TIMING_OPTIONS: Array<{
  id: CalendarRuleTiming;
  label: string;
  hint: string;
}> = [
  {
    id: "during",
    label: "Während des ganzen Termins",
    hint: "Die ganze Zeit, solange der Termin läuft",
  },
  {
    id: "before",
    label: "Rechtzeitig vor dem Termin warm",
    hint: "z. B. Büro ab 8:00 → Bad soll schon um 7:00 warm sein. Die Heizung startet früher, damit die Temperatur rechtzeitig da ist.",
  },
  {
    id: "after",
    label: "Nach dem Termin wieder warm",
    hint: "z. B. Bürgerbüro bis 13:00 → Schlafzimmer soll um 14:00 wieder warm sein. Die Heizung startet rechtzeitig vorher.",
  },
];

const OFF_TIMING_OPTIONS: Array<{
  id: CalendarRuleTiming;
  label: string;
  hint: string;
}> = [
  {
    id: "during",
    label: "Während des ganzen Termins",
    hint: "Aus, solange der Termin läuft (z. B. Büro aus während du weg bist)",
  },
  {
    id: "before",
    label: "Schon vor dem Termin aus",
    hint: "Räume vorher ausschalten — z. B. eine Stunde vor Start",
  },
  {
    id: "after",
    label: "Nach dem Termin aus",
    hint: "Räume nach dem Ende ausschalten — z. B. eine Stunde danach",
  },
];

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

function timingLabel(
  t: CalendarRuleTiming | undefined,
  kind: "heat" | "off" = "heat",
): string {
  const list = kind === "off" ? OFF_TIMING_OPTIONS : HEAT_TIMING_OPTIONS;
  return list.find((o) => o.id === (t ?? "during"))?.label ?? "während des Termins";
}

function rulePlainSummary(rule: CalendarRule, zones: Zone[]): string {
  const heat = rule.roomIds
    .map((id) => zones.find((z) => z.id === id)?.name ?? id)
    .join(", ");
  const off = (rule.offRoomIds ?? [])
    .map((id) => zones.find((z) => z.id === id)?.name ?? id)
    .join(", ");
  const parts: string[] = [];
  if (heat) {
    parts.push(
      `${heat} auf ${rule.targetTempC != null ? `${rule.targetTempC.toFixed(0)}°` : "—"} (${timingLabel(rule.timing, "heat")})`,
    );
  }
  if (off) {
    parts.push(
      `${off} aus (${timingLabel(rule.offTiming ?? rule.timing, "off")})`,
    );
  }
  const when =
    rule.match.kind === "event_uid"
      ? `${rule.match.eventUids?.length ?? 1} Termin(e)`
      : `Titel enthält „${rule.match.value}“`;
  return `${when} · ${parts.join(" · ") || "keine Räume"}`;
}

function TimingPicker({
  value,
  onChange,
  kind,
}: {
  value: CalendarRuleTiming;
  onChange: (t: CalendarRuleTiming) => void;
  kind: "heat" | "off";
}) {
  const options = kind === "off" ? OFF_TIMING_OPTIONS : HEAT_TIMING_OPTIONS;
  return (
    <div className="cal-wiz__timing">
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          className={value === opt.id ? "cal-wiz__choice is-on" : "cal-wiz__choice"}
          onClick={() => onChange(opt.id)}
        >
          <strong>{opt.label}</strong>
          <span className="cal-wiz__meta">{opt.hint}</span>
        </button>
      ))}
    </div>
  );
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
  const [how, setHow] = useState<HowKind>("events");
  const [pickedUids, setPickedUids] = useState<string[]>([]);
  const [pattern, setPattern] = useState("");
  const [ruleName, setRuleName] = useState("");
  const [heatIds, setHeatIds] = useState<string[]>(
    focusRoomId ? [focusRoomId] : [],
  );
  const [offIds, setOffIds] = useState<string[]>([]);
  const [tempC, setTempC] = useState(20);
  const [heatTiming, setHeatTiming] = useState<CalendarRuleTiming>("during");
  const [offTiming, setOffTiming] = useState<CalendarRuleTiming>("during");
  const [readyBefore, setReadyBefore] = useState(60);
  const [readyAfter, setReadyAfter] = useState(60);
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

  function resetDraft(): void {
    setHow("events");
    setPickedUids([]);
    setPattern("");
    setRuleName("");
    setHeatIds(focusRoomId ? [focusRoomId] : []);
    setOffIds([]);
    setTempC(20);
    setHeatTiming("during");
    setOffTiming("during");
    setReadyBefore(60);
    setReadyAfter(60);
    setDoneMsg(null);
    setError(null);
  }

  function startNewRule(): void {
    resetDraft();
    setStep(configured ? "how" : "connect");
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
      setStep("how");
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

  function togglePick(uid: string): void {
    setPickedUids((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid],
    );
  }

  function setHeat(id: string): void {
    setOffIds((prev) => prev.filter((x) => x !== id));
    setHeatIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function setOff(id: string): void {
    setHeatIds((prev) => prev.filter((x) => x !== id));
    setOffIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function suggestName(): string {
    if (how === "pattern" && pattern.trim()) {
      return `Wenn „${pattern.trim()}“`;
    }
    const names = events
      .filter((e) => pickedUids.includes(e.uid))
      .map((e) => e.summary);
    if (names.length === 1) {
      return names[0];
    }
    if (names.length > 1) {
      return `${names[0]} +${names.length - 1}`;
    }
    return "";
  }

  function goName(): void {
    if (!ruleName.trim()) {
      setRuleName(suggestName());
    }
    setStep("name");
  }

  async function finishRule(): Promise<void> {
    const finalName = ruleName.trim() || suggestName();
    if (!finalName) {
      setError("Bitte einen Namen für die Regel eingeben.");
      setStep("name");
      return;
    }
    setRuleName(finalName);
    if (heatIds.length === 0 && offIds.length === 0) {
      setError("Bitte mindestens einen Raum zum Heizen oder Ausschalten wählen.");
      return;
    }
    if (how === "events" && pickedUids.length === 0) {
      setError("Bitte mindestens einen Termin wählen — oder „Titel enthält …“ nutzen.");
      setStep("how");
      return;
    }
    if (how === "pattern" && !pattern.trim()) {
      setError("Bitte ein Wort aus dem Termintitel eingeben.");
      setStep("pattern");
      return;
    }

    setActionBusy(true);
    setError(null);
    try {
      if (how === "events" && pickedUids.length > 0) {
        const selected = Array.from(
          new Set([...(status?.selectedUids ?? []), ...pickedUids]),
        );
        await saveCalendarEventSelection(selected);
      }

      const first = events.find((e) => e.uid === pickedUids[0]);
      await createCalendarRule({
        name: finalName,
        enabled: true,
        calendarId: how === "events" ? (first?.calendarId ?? null) : null,
        match:
          how === "events"
            ? {
                kind: "event_uid",
                value: pickedUids[0],
                eventUids: pickedUids,
              }
            : {
                kind: "title_contains",
                value: pattern.trim(),
              },
        roomIds: heatIds,
        offRoomIds: offIds,
        mode: heatIds.length > 0 ? "heat" : "off",
        targetTempC: heatIds.length > 0 ? tempC : null,
        timing: heatTiming,
        offTiming,
        readyMinutesBefore: readyBefore,
        readyMinutesAfter: readyAfter,
        applyPath: "hap_overlay",
        priority: 200,
      });

      try {
        const result = await evaluateCalendarRules();
        onQuotaRef.current?.(result.quota);
        setDoneMsg(
          result.matched > 0
            ? "Alles eingerichtet. Wenn der Termin passt, wird gesteuert."
            : "Gespeichert. Sobald ein passender Termin läuft, greift die Regel automatisch.",
        );
      } catch (err) {
        if (err instanceof ApiError && err.quota) {
          onQuotaRef.current?.(err.quota);
        }
        setDoneMsg(
          "Regel gespeichert. Sie greift automatisch, sobald der Termin passt.",
        );
      }
      await refreshStatus();
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Speichern fehlgeschlagen");
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
    const order: WizardStep[] = [
      "overview",
      "connect",
      "how",
      "events",
      "pattern",
      "name",
      "rooms",
      "done",
      "advanced",
    ];
    if (step === "overview" || step === "advanced") {
      if (step === "advanced") {
        setStep("overview");
        return;
      }
      onBack();
      return;
    }
    if (step === "connect") {
      setStep("overview");
      return;
    }
    if (step === "how") {
      setStep(configured ? "overview" : "connect");
      return;
    }
    if (step === "events" || step === "pattern") {
      setStep("how");
      return;
    }
    if (step === "name") {
      setStep(how === "events" ? "events" : "pattern");
      return;
    }
    if (step === "rooms") {
      setStep("name");
      return;
    }
    if (step === "done") {
      setStep("overview");
      return;
    }
    const i = order.indexOf(step);
    setStep(order[Math.max(0, i - 1)]);
  }

  const stepPill =
    step === "how"
      ? "1"
      : step === "events" || step === "pattern"
        ? "2"
        : step === "name"
          ? "3"
          : step === "rooms"
            ? "4"
            : step === "done"
              ? "✓"
              : "";

  const headerTitle =
    step === "overview"
      ? "Termine & Heizung"
      : step === "connect"
        ? "iPhone-Kalender"
        : step === "how"
          ? "Wie soll’s greifen?"
          : step === "events"
            ? "Termine wählen"
            : step === "pattern"
              ? "Nach Titel"
              : step === "name"
                ? "Name der Regel"
                : step === "rooms"
                  ? "Räume & Zeitpunkt"
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
          aria-label="Zurück"
        >
          <BackIcon />
        </button>
        <h1>{headerTitle}</h1>
        <span className="cal-wiz__step-pill" aria-hidden="true">
          {stepPill}
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
            Termine aus dem iPhone steuern die Heizung — auch wenn der Termin erst
            später kommt.
          </p>
          <button
            type="button"
            className="cal-wiz__primary"
            disabled={actionBusy}
            onClick={startNewRule}
          >
            Neue Regel anlegen
          </button>
          <p className="cal-wiz__hint">
            {configured
              ? `Kalender verbunden${status?.connection.username ? ` (${status.connection.username})` : ""}.`
              : "Noch nicht verbunden — der Assistent hilft Schritt für Schritt."}
          </p>
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
            <p className="cal-wiz__meta">Noch keine Regeln.</p>
          )}
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
            <li>iPhone: Einstellungen → [dein Name] → Anmeldung &amp; Sicherheit</li>
            <li>„App-Passwort“ erzeugen (z. B. Heizplan)</li>
            <li>Hier eintragen und weiter</li>
          </ol>
          <label className="cal-wiz__field">
            <span>Apple-ID (E-Mail)</span>
            <input
              type="email"
              value={connectUser}
              disabled={actionBusy}
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

      {step === "how" ? (
        <div className="cal-wiz__body">
          <p className="cal-wiz__lead">Wie soll die Regel greifen?</p>
          <button
            type="button"
            className={how === "events" ? "cal-wiz__choice is-on" : "cal-wiz__choice"}
            onClick={() => setHow("events")}
          >
            <strong>Termine auswählen</strong>
            <span className="cal-wiz__meta">
              Auch zukünftige Termine aus der Liste — mehrere möglich
            </span>
          </button>
          <button
            type="button"
            className={how === "pattern" ? "cal-wiz__choice is-on" : "cal-wiz__choice"}
            onClick={() => setHow("pattern")}
          >
            <strong>Wenn der Titel … enthält</strong>
            <span className="cal-wiz__meta">
              Auch wenn der Termin noch nicht in der Liste steht (z. B. „Büro“)
            </span>
          </button>
          <div className="cal-wiz__nav">
            <button type="button" className="cal-wiz__ghost" onClick={stepBack}>
              Zurück
            </button>
            <button
              type="button"
              className="cal-wiz__primary"
              onClick={() => {
                if (how === "events") {
                  setStep("events");
                  void loadEvents();
                } else {
                  setStep("pattern");
                }
              }}
            >
              Weiter
            </button>
          </div>
        </div>
      ) : null}

      {step === "events" ? (
        <div className="cal-wiz__body">
          <p className="cal-wiz__lead">
            Tippe alle Termine an, die gelten sollen (auch in der Zukunft).
          </p>
          <p className="cal-wiz__hint">
            Fehlt der Termin noch? Zurück → „Wenn der Titel … enthält“.
          </p>
          <button
            type="button"
            className="cal-wiz__secondary"
            disabled={eventsBusy}
            onClick={() => void loadEvents()}
          >
            {eventsBusy ? "Lade…" : "Termine aktualisieren"}
          </button>
          {events.length === 0 && !eventsBusy ? (
            <p className="cal-wiz__meta">
              Keine Termine in den nächsten Tagen. Lege einen im iPhone an — oder nutze
              „Titel enthält …“.
            </p>
          ) : null}
          <ul className="cal-wiz__list">
            {events.map((ev) => {
              const on = pickedUids.includes(ev.uid);
              return (
                <li key={ev.uid}>
                  <button
                    type="button"
                    className={on ? "cal-wiz__event is-on" : "cal-wiz__event"}
                    onClick={() => togglePick(ev.uid)}
                  >
                    <strong>
                      {on ? "✓ " : ""}
                      {ev.summary}
                    </strong>
                    <span className="cal-wiz__meta">
                      {formatWhen(ev.startsAt)} – {formatWhen(ev.endsAt)}
                      {ev.calendarName ? ` · ${ev.calendarName}` : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="cal-wiz__meta">
            {pickedUids.length === 0
              ? "Noch keiner gewählt"
              : `${pickedUids.length} Termin(e) gewählt`}
          </p>
          <div className="cal-wiz__nav">
            <button type="button" className="cal-wiz__ghost" onClick={stepBack}>
              Zurück
            </button>
            <button
              type="button"
              className="cal-wiz__primary"
              disabled={pickedUids.length === 0}
              onClick={goName}
            >
              Weiter
            </button>
          </div>
        </div>
      ) : null}

      {step === "pattern" ? (
        <div className="cal-wiz__body">
          <p className="cal-wiz__lead">
            Welches Wort soll im Termintitel stehen? Die Regel gilt auch für Termine,
            die du erst später anlegst.
          </p>
          <label className="cal-wiz__field">
            <span>Titel enthält</span>
            <input
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder="z. B. Büro"
              autoCapitalize="none"
            />
          </label>
          <p className="cal-wiz__hint">
            Beispiel: „Büro“ greift auf „Büro“, „Home Office Büro“, …
          </p>
          <div className="cal-wiz__nav">
            <button type="button" className="cal-wiz__ghost" onClick={stepBack}>
              Zurück
            </button>
            <button
              type="button"
              className="cal-wiz__primary"
              disabled={!pattern.trim()}
              onClick={goName}
            >
              Weiter
            </button>
          </div>
        </div>
      ) : null}

      {step === "name" ? (
        <div className="cal-wiz__body">
          <p className="cal-wiz__lead">Wie soll die Regel heißen?</p>
          <label className="cal-wiz__field">
            <span>Name (empfohlen)</span>
            <input
              value={ruleName}
              onChange={(e) => setRuleName(e.target.value)}
              placeholder={suggestName() || "z. B. Büro-Tage"}
            />
          </label>
          {!ruleName.trim() && suggestName() ? (
            <button
              type="button"
              className="cal-wiz__link"
              onClick={() => setRuleName(suggestName())}
            >
              Vorschlag übernehmen: {suggestName()}
            </button>
          ) : null}
          <div className="cal-wiz__nav">
            <button type="button" className="cal-wiz__ghost" onClick={stepBack}>
              Zurück
            </button>
            <button
              type="button"
              className="cal-wiz__primary"
              disabled={!ruleName.trim() && !suggestName()}
              onClick={() => {
                const next = ruleName.trim() || suggestName();
                if (!next) {
                  setError("Bitte einen Namen eingeben.");
                  return;
                }
                setRuleName(next);
                setStep("rooms");
              }}
            >
              Weiter
            </button>
          </div>
        </div>
      ) : null}

      {step === "rooms" ? (
        <div className="cal-wiz__body">
          <p className="cal-wiz__lead">Was soll passieren?</p>

          <h2 className="cal-wiz__h">Räume heizen</h2>
          <div className="cal-wiz__rooms">
            {zones.map((z) => (
              <button
                key={`h-${z.id}`}
                type="button"
                className={heatIds.includes(z.id) ? "cal-wiz__chip is-on" : "cal-wiz__chip"}
                onClick={() => setHeat(z.id)}
              >
                {z.name}
              </button>
            ))}
          </div>
          {heatIds.length > 0 ? (
            <>
              <h2 className="cal-wiz__h">Wie warm?</h2>
              <div className="cal-wiz__temps">
                {TEMP_PRESETS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={tempC === t ? "cal-wiz__chip is-on" : "cal-wiz__chip"}
                    onClick={() => setTempC(t)}
                  >
                    {t}°
                  </button>
                ))}
              </div>
              <label className="cal-wiz__field">
                <span>Genau (°C)</span>
                <input
                  type="number"
                  min={5}
                  max={30}
                  step={0.5}
                  value={tempC}
                  onChange={(e) => setTempC(Number(e.target.value) || 20)}
                />
              </label>
              <h2 className="cal-wiz__h">Wann heizen?</h2>
              <TimingPicker
                kind="heat"
                value={heatTiming}
                onChange={setHeatTiming}
              />
              {heatTiming === "before" ? (
                <label className="cal-wiz__field">
                  <span>Warm erreicht … Minuten vor Terminbeginn</span>
                  <input
                    type="number"
                    min={0}
                    max={240}
                    step={15}
                    value={readyBefore}
                    onChange={(e) =>
                      setReadyBefore(Number(e.target.value) || 60)
                    }
                  />
                </label>
              ) : null}
              {heatTiming === "after" ? (
                <label className="cal-wiz__field">
                  <span>Warm erreicht … Minuten nach Terminende</span>
                  <input
                    type="number"
                    min={0}
                    max={240}
                    step={15}
                    value={readyAfter}
                    onChange={(e) =>
                      setReadyAfter(Number(e.target.value) || 60)
                    }
                  />
                </label>
              ) : null}
              {heatTiming === "before" || heatTiming === "after" ? (
                <p className="cal-wiz__hint">
                  Die Heizung startet früher (aktuell ca. 60 Min. Vorlauf), damit
                  die Temperatur pünktlich da ist.
                </p>
              ) : null}
            </>
          ) : null}

          <h2 className="cal-wiz__h">Räume ausschalten</h2>
          <div className="cal-wiz__rooms">
            {zones.map((z) => (
              <button
                key={`o-${z.id}`}
                type="button"
                className={offIds.includes(z.id) ? "cal-wiz__chip is-off" : "cal-wiz__chip"}
                onClick={() => setOff(z.id)}
              >
                {z.name}
              </button>
            ))}
          </div>
          {offIds.length > 0 ? (
            <>
              <h2 className="cal-wiz__h">Wann ausschalten?</h2>
              <TimingPicker
                kind="off"
                value={offTiming}
                onChange={setOffTiming}
              />
              {offTiming === "before" ? (
                <label className="cal-wiz__field">
                  <span>Aus … Minuten vor Terminbeginn</span>
                  <input
                    type="number"
                    min={0}
                    max={240}
                    step={15}
                    value={readyBefore}
                    onChange={(e) =>
                      setReadyBefore(Number(e.target.value) || 60)
                    }
                  />
                </label>
              ) : null}
              {offTiming === "after" ? (
                <label className="cal-wiz__field">
                  <span>Aus … Minuten nach Terminende</span>
                  <input
                    type="number"
                    min={0}
                    max={240}
                    step={15}
                    value={readyAfter}
                    onChange={(e) =>
                      setReadyAfter(Number(e.target.value) || 60)
                    }
                  />
                </label>
              ) : null}
            </>
          ) : null}

          <div className="cal-wiz__nav">
            <button type="button" className="cal-wiz__ghost" onClick={stepBack}>
              Zurück
            </button>
            <button
              type="button"
              className="cal-wiz__primary"
              disabled={
                actionBusy || (heatIds.length === 0 && offIds.length === 0)
              }
              onClick={() => {
                if (!ruleName.trim()) {
                  setRuleName(suggestName());
                }
                void finishRule();
              }}
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
          <p className="cal-wiz__meta">
            {ruleName}
            {how === "pattern"
              ? ` · Titel enthält „${pattern}“`
              : ` · ${pickedUids.length} Termin(e)`}
            {heatIds.length > 0
              ? ` · Heizen: ${timingLabel(heatTiming, "heat")}`
              : ""}
            {offIds.length > 0
              ? ` · Aus: ${timingLabel(offTiming, "off")}`
              : ""}
          </p>
          <button
            type="button"
            className="cal-wiz__primary"
            onClick={() => {
              setStep("overview");
              resetDraft();
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
            Für Technik-Interessierte. Im Alltag reicht der Assistent.
          </p>
          <CalendarConnectionPanel
            onChanged={() => {
              void refreshStatus();
            }}
          />
          <button
            type="button"
            className="cal-wiz__primary"
            onClick={() => setStep("overview")}
          >
            Zurück zur Übersicht
          </button>
        </div>
      ) : null}
    </div>
  );
}
