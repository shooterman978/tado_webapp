/**
 * Heizplan › Protokoll — filterable event log drill-in.
 * Shows actor/source + detail line (same density as Cloud-Request-Log).
 * @package @heizplan/web
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ProtocolActorKind,
  ProtocolEvent,
  ProtocolEventCategory,
  ProtocolEventsResponse,
} from "@heizplan/shared";
import { fetchProtocolEvents, postProtocolClientEvent } from "../api";
import { PageChrome, type BreadcrumbAncestor } from "./PageChrome";

export type ProtocolRangePreset = "today" | "24h" | "7d" | "all";

export interface ProtocolPanelProps {
  onBack: () => void;
  onHome?: () => void;
  ancestors?: BreadcrumbAncestor[];
  /** Deep-link: start with category chip (e.g. quota from Cloud & Kontingent). */
  initialCategory?: ProtocolEventCategory | "all";
  /** Deep-link: start with actor chip. */
  initialActor?: ProtocolActorKind | "all";
  /** Deep-link: start with time range (default today). */
  initialRange?: ProtocolRangePreset;
  /** Open Cloud & Kontingent for the detailed request log. */
  onOpenCloud?: () => void;
}

const CATEGORY_LABELS: Record<ProtocolEventCategory | "all", string> = {
  all: "Alle",
  polling: "Abfrage",
  user: "Bedienung",
  feedback: "Hinweise",
  calendar: "Termine",
  presence: "Zuhause/Weg",
  quota: "Kontingent",
  window: "Fenster",
  heatup: "Vorwärmen",
  schedule: "Zeitplan",
  bridge: "Bridge",
  system: "System",
};

const ACTOR_LABELS: Record<ProtocolActorKind | "all", string> = {
  all: "Alle",
  user: "Du",
  calendar: "Kalender",
  window: "Fenster",
  heatup: "Vorwärmen",
  presence: "Geofencing",
  cloud: "Cloud",
  bridge: "Bridge",
  poll: "Hintergrund",
  system: "System",
};

const FILTER_CHIPS: Array<ProtocolEventCategory | "all"> = [
  "all",
  "calendar",
  "presence",
  "window",
  "heatup",
  "quota",
  "schedule",
  "bridge",
  "user",
  "feedback",
  "polling",
];

const ACTOR_CHIPS: Array<ProtocolActorKind | "all"> = [
  "all",
  "user",
  "calendar",
  "window",
  "heatup",
  "presence",
  "cloud",
  "bridge",
  "poll",
  "system",
];

function formatWhen(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: "Europe/Berlin",
    });
  } catch {
    return iso;
  }
}

function categoryTone(cat: ProtocolEventCategory): string {
  switch (cat) {
    case "calendar":
      return "#0a84ff";
    case "presence":
      return "#30d158";
    case "window":
      return "#64d2ff";
    case "heatup":
      return "#ff9f0a";
    case "quota":
      return "#ffd60a";
    case "bridge":
      return "#ff453a";
    case "user":
      return "#bf5af2";
    case "feedback":
      return "#ff6482";
    case "schedule":
      return "#5e5ce6";
    case "polling":
      return "#8e8e93";
    default:
      return "#636366";
  }
}

function rangeBounds(preset: ProtocolRangePreset): {
  todayOnly: boolean;
  since?: string;
} {
  const now = Date.now();
  if (preset === "today") {
    return { todayOnly: true };
  }
  if (preset === "24h") {
    return { todayOnly: false, since: new Date(now - 24 * 3_600_000).toISOString() };
  }
  if (preset === "7d") {
    return { todayOnly: false, since: new Date(now - 7 * 24 * 3_600_000).toISOString() };
  }
  return { todayOnly: false };
}

function shortPath(path: string): string {
  return path.replace(/^\/api\/v2/, "") || path;
}

/**
 * Second line — same informational density as Cloud-Request-Log rows.
 * Prefer method/path/Δ, then rule/room/mode/temp, then leftover keys.
 */
export function formatProtocolDetailLine(entry: ProtocolEvent): string {
  const d = entry.detail ?? {};
  const parts: string[] = [];

  const method = typeof d.method === "string" ? d.method : "";
  const pathVal = typeof d.path === "string" ? shortPath(d.path) : "";
  if (method || pathVal) {
    parts.push(`${method} ${pathVal}`.trim());
  }
  if (typeof d.delta === "number") {
    parts.push(`+${d.delta}`);
  }

  const label =
    typeof d.groupLabel === "string" && d.groupLabel.trim()
      ? d.groupLabel.trim()
      : typeof d.label === "string"
        ? d.label.trim()
        : "";
  // Avoid repeating the headline when message already contains the label.
  if (label && !entry.message.includes(label)) {
    parts.push(label);
  }

  const ruleName = typeof d.ruleName === "string" ? d.ruleName.trim() : "";
  if (ruleName && !entry.message.includes(ruleName)) {
    parts.push(ruleName);
  }
  const eventSummary =
    typeof d.eventSummary === "string" ? d.eventSummary.trim() : "";
  if (eventSummary && eventSummary !== ruleName) {
    parts.push(eventSummary);
  }

  if (typeof d.mode === "string") {
    parts.push(d.mode === "off" ? "Aus" : d.mode === "heat" ? "Heizen" : d.mode);
  }
  if (typeof d.targetTempC === "number") {
    parts.push(`${d.targetTempC} °C`);
  }
  if (typeof d.tempC === "number") {
    parts.push(`${d.tempC} °C`);
  }
  if (typeof d.durationMinutes === "number") {
    parts.push(`${d.durationMinutes} Min`);
  }
  if (typeof d.resumeMode === "string") {
    parts.push(
      d.resumeMode === "restore_setpoint"
        ? "Sollwert wiederherstellen"
        : d.resumeMode === "clear_overlay"
          ? "Zeitplan fortsetzen"
          : d.resumeMode,
    );
  }
  if (typeof d.reason === "string" && d.reason.trim()) {
    parts.push(d.reason.trim());
  }
  if (typeof d.action === "string" && d.action.trim()) {
    parts.push(d.action.trim());
  }
  if (typeof d.from === "string" && typeof d.to === "string") {
    parts.push(`${d.from} → ${d.to}`);
  } else if (typeof d.from === "string") {
    parts.push(`von ${d.from}`);
  }
  if (typeof d.used === "number" && typeof d.limit === "number") {
    parts.push(`${d.used}/${d.limit}`);
  }
  if (typeof d.remaining === "number" && !parts.some((p) => p.includes("/"))) {
    parts.push(`${d.remaining} übrig`);
  }
  if (typeof d.applied === "number" || typeof d.cleared === "number") {
    const a = typeof d.applied === "number" ? d.applied : 0;
    const c = typeof d.cleared === "number" ? d.cleared : 0;
    parts.push(`+${a} / −${c}`);
  }
  if (typeof d.openWindowCount === "number") {
    parts.push(`${d.openWindowCount} Fenster offen`);
  }
  if (typeof d.homeName === "string" && d.homeName.trim()) {
    parts.push(d.homeName.trim());
  }
  if (typeof d.okSampleCount === "number") {
    parts.push(`${d.okSampleCount} Samples`);
  }
  if (typeof d.rateEmaCPerMin === "number") {
    parts.push(`${d.rateEmaCPerMin.toFixed(3)} °C/min`);
  }
  if (typeof d.message === "string" && d.message.trim()) {
    parts.push(d.message.trim().slice(0, 80));
  }
  if (typeof d.source === "string" && d.source.trim()) {
    parts.push(d.source.trim());
  }
  if (typeof d.state === "string" && d.state.trim()) {
    parts.push(d.state.trim());
  }
  if (typeof d.paired === "boolean") {
    parts.push(d.paired ? "verbunden" : "getrennt");
  }
  if (typeof d.panel === "string" && d.panel.trim()) {
    parts.push(d.panel.trim());
  }
  if (typeof d.initial === "boolean" && d.initial) {
    parts.push("erstmals");
  }
  if (typeof d.previousTargetTempC === "number") {
    parts.push(`vorher ${d.previousTargetTempC} °C`);
  }
  if (typeof d.deviceCount === "number") {
    parts.push(`${d.deviceCount} Geräte`);
  }
  if (typeof d.matched === "number") {
    parts.push(`${d.matched} Treffer`);
  }

  const roomLabel =
    (typeof d.roomName === "string" && d.roomName.trim()) ||
    (typeof d.zoneName === "string" && d.zoneName.trim()) ||
    entry.roomId ||
    "";
  if (roomLabel) {
    parts.push(roomLabel);
  }

  // Leftover scalar keys not already rendered (agent-friendly density).
  const consumed = new Set([
    "method",
    "path",
    "delta",
    "label",
    "groupLabel",
    "groupId",
    "ruleName",
    "ruleId",
    "eventUid",
    "eventSummary",
    "mode",
    "targetTempC",
    "tempC",
    "durationMinutes",
    "resumeMode",
    "reason",
    "action",
    "from",
    "to",
    "used",
    "limit",
    "remaining",
    "applied",
    "cleared",
    "openWindowCount",
    "homeName",
    "okSampleCount",
    "rateEmaCPerMin",
    "sampleId",
    "message",
    "roomName",
    "zoneName",
    "roomKey",
    "cloudZoneId",
    "source",
    "state",
    "paired",
    "panel",
    "initial",
    "previousTargetTempC",
    "deviceCount",
    "matched",
    "dayKey",
  ]);
  for (const [key, value] of Object.entries(d)) {
    if (consumed.has(key) || value == null) {
      continue;
    }
    if (typeof value === "string" && value.trim()) {
      parts.push(`${key}=${value.trim().slice(0, 60)}`);
    } else if (typeof value === "number" || typeof value === "boolean") {
      parts.push(`${key}=${value}`);
    }
  }

  if (parts.length === 0) {
    return entry.type;
  }
  // Keep type as a quiet trailing hint for agent analysis.
  parts.push(entry.type);
  return parts.join(" · ");
}

function actorLabel(entry: ProtocolEvent): string {
  if (entry.actor?.label?.trim()) {
    return entry.actor.label.trim();
  }
  if (entry.actor?.kind) {
    return ACTOR_LABELS[entry.actor.kind] ?? entry.actor.kind;
  }
  return ACTOR_LABELS.system;
}

export function ProtocolPanel({
  onBack,
  onHome,
  ancestors,
  initialCategory = "all",
  initialActor = "all",
  initialRange = "today",
  onOpenCloud,
}: ProtocolPanelProps) {
  const [category, setCategory] = useState<ProtocolEventCategory | "all">(
    initialCategory,
  );
  const [actor, setActor] = useState<ProtocolActorKind | "all">(initialActor);
  const [range, setRange] = useState<ProtocolRangePreset>(initialRange);
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [data, setData] = useState<ProtocolEventsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const bounds = rangeBounds(range);
      const res = await fetchProtocolEvents({
        category,
        actor,
        q: search || undefined,
        todayOnly: bounds.todayOnly,
        since: bounds.since,
        limit: 200,
      });
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Protokoll laden fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }, [category, actor, range, search]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void postProtocolClientEvent({
      category: "user",
      type: "user.navigate",
      message: "Protokoll geöffnet",
      detail: { panel: "protocol" },
    }).catch(() => {
      /* ignore */
    });
  }, []);

  const entries = data?.entries ?? [];

  const emptyHint = useMemo(() => {
    if (busy) {
      return null;
    }
    if (entries.length > 0) {
      return null;
    }
    if (search || category !== "all" || actor !== "all" || range !== "all") {
      return "Keine Einträge für diese Filter.";
    }
    return "Noch keine Ereignisse — Automationen und Bedienung füllen das Protokoll.";
  }, [busy, entries.length, search, category, actor, range]);

  const resetFilters = () => {
    setSearch("");
    setSearchDraft("");
    setCategory("all");
    setActor("all");
    setRange("all");
  };

  return (
    <div className="dash-panel protocol-panel">
      <PageChrome
        current="Protokoll"
        ancestors={ancestors}
        onBack={onBack}
        onHome={onHome}
      />

      <p className="settings__hint settings__hint--inline">
        Wer etwas getan hat (Du, Kalenderregel, Fenster, Cloud …) und was genau —
        wie bei Cloud-Requests. Ohne Secrets.
      </p>

      {onOpenCloud ? (
        <button
          type="button"
          className="protocol-panel__cloud-link"
          onClick={onOpenCloud}
        >
          Cloud &amp; Kontingent öffnen
          <span aria-hidden="true">→</span>
        </button>
      ) : null}

      <div className="protocol-filters" role="search">
        <label className="protocol-filters__search">
          <span className="visually-hidden">Suche</span>
          <input
            type="search"
            value={searchDraft}
            placeholder="Suche…"
            enterKeyHint="search"
            onChange={(e) => setSearchDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setSearch(searchDraft.trim());
              }
            }}
          />
          <button
            type="button"
            className="protocol-filters__go"
            onClick={() => setSearch(searchDraft.trim())}
          >
            Suchen
          </button>
        </label>

        <div className="protocol-filters__ranges" role="group" aria-label="Zeitraum">
          {(
            [
              ["today", "Heute"],
              ["24h", "24 Std."],
              ["7d", "7 Tage"],
              ["all", "Alles"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={
                range === id
                  ? "protocol-chip protocol-chip--active"
                  : "protocol-chip"
              }
              aria-pressed={range === id}
              onClick={() => setRange(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="protocol-filters__cats" role="group" aria-label="Von wem">
          {ACTOR_CHIPS.map((id) => (
            <button
              key={id}
              type="button"
              className={
                actor === id
                  ? "protocol-chip protocol-chip--active"
                  : "protocol-chip"
              }
              aria-pressed={actor === id}
              onClick={() => setActor(id)}
            >
              {ACTOR_LABELS[id]}
            </button>
          ))}
        </div>

        <div className="protocol-filters__cats" role="group" aria-label="Kategorie">
          {FILTER_CHIPS.map((id) => (
            <button
              key={id}
              type="button"
              className={
                category === id
                  ? "protocol-chip protocol-chip--active"
                  : "protocol-chip"
              }
              aria-pressed={category === id}
              onClick={() => setCategory(id)}
            >
              {CATEGORY_LABELS[id]}
            </button>
          ))}
        </div>

        <div className="protocol-filters__toolbar">
          <span className="protocol-filters__meta">
            {data
              ? `${entries.length} angezeigt · Buffer ${data.retained}/${data.maxRetained}`
              : "—"}
          </span>
          <button
            type="button"
            className="cloud-log__refresh"
            disabled={busy}
            onClick={() => void load()}
          >
            {busy ? "…" : "Aktualisieren"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="empty-panel empty-panel--danger" role="alert">
          <strong className="empty-panel__title">Protokoll nicht geladen</strong>
          <p className="empty-panel__body">{error}</p>
          <button
            type="button"
            className="empty-panel__action"
            onClick={() => void load()}
          >
            Erneut versuchen
          </button>
        </div>
      ) : null}

      {emptyHint && !error ? (
        <div className="empty-panel empty-panel--compact" role="status">
          <strong className="empty-panel__title">Noch nichts zu sehen</strong>
          <p className="empty-panel__body">{emptyHint}</p>
          {search || category !== "all" || actor !== "all" || range !== "all" ? (
            <button
              type="button"
              className="empty-panel__action empty-panel__action--ghost"
              onClick={resetFilters}
            >
              Filter zurücksetzen
            </button>
          ) : null}
        </div>
      ) : null}

      <ul className="protocol-list">
        {entries.map((entry) => (
          <ProtocolRow key={entry.id} entry={entry} />
        ))}
      </ul>
    </div>
  );
}

function ProtocolRow({ entry }: { entry: ProtocolEvent }) {
  const tone = categoryTone(entry.category);
  const who = actorLabel(entry);
  const detailLine = formatProtocolDetailLine(entry);
  return (
    <li className="protocol-row">
      <span
        className="protocol-row__dot"
        style={{ background: tone }}
        aria-hidden="true"
      />
      <div className="protocol-row__body">
        <div className="protocol-row__top">
          <time className="protocol-row__time" dateTime={entry.at}>
            {formatWhen(entry.at)}
          </time>
          <span className="protocol-row__actor" title="Von wem">
            {who}
          </span>
          <span className="protocol-row__cat" style={{ color: tone }}>
            {CATEGORY_LABELS[entry.category]}
          </span>
        </div>
        <p className="protocol-row__msg">{entry.message}</p>
        <p className="protocol-row__detail">{detailLine}</p>
      </div>
    </li>
  );
}
