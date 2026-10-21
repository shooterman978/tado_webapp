/**
 * Heizplan › Protokoll — filterable event log drill-in.
 * Filter groups (Zeitraum | Von wem | Was) + everyday titles; technical meta under Details.
 * @package @heizplan/web
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  ProtocolActorKind,
  ProtocolEvent,
  ProtocolEventCategory,
  ProtocolEventType,
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

/** Fallback title when message is empty / purely technical. */
const TYPE_TITLES: Partial<Record<ProtocolEventType, string>> = {
  "polling.zones": "Räume aktualisiert",
  "polling.calendar": "Termine geprüft",
  "user.setpoint": "Solltemperatur geändert",
  "user.power": "Heizung geschaltet",
  "user.resume_schedule": "Zeitplan fortgesetzt",
  "user.quick_action": "Schnellaktion",
  "user.settings": "Einstellungen geändert",
  "user.navigate": "Ansicht geöffnet",
  "feedback.error": "Etwas ist schiefgelaufen",
  "feedback.success": "Erledigt",
  "calendar.override_apply": "Termin heizt mit",
  "calendar.override_clear": "Termin beendet",
  "presence.home": "Zuhause",
  "presence.away": "Unterwegs",
  "presence.changed": "Zuhause/Unterwegs gewechselt",
  "quota.near_limit": "Cloud-Kontingent fast voll",
  "quota.blocked": "Cloud-Kontingent aufgebraucht",
  "quota.request": "Cloud-Anfrage",
  "window.open": "Fenster offen",
  "window.closed": "Fenster zu",
  "window.auto_off": "Heizung wegen Fenster aus",
  "window.resume": "Heizung nach Fenster wieder an",
  "heatup.accept": "Vorwärmen übernommen",
  "heatup.reject": "Vorwärmen verworfen",
  "heatup.started": "Vorwärmen gestartet",
  "schedule.sync": "Zeitplan synchronisiert",
  "schedule.home_sync": "Zuhause synchronisiert",
  "bridge.disconnect": "Bridge getrennt",
  "bridge.reconnect": "Bridge wieder verbunden",
  "bridge.error": "Bridge-Fehler",
  "system.info": "Systemhinweis",
};

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

function presenceWord(value: string): string {
  if (value === "home") {
    return "Zuhause";
  }
  if (value === "away") {
    return "Unterwegs";
  }
  return value;
}

/** Soften common Cloud API / group labels for the human title. */
const CLOUD_LABEL_DE: Record<string, string> = {
  "presence.homeState": "Zuhause-Status",
  "auth.token": "Anmeldung",
  "auth.refresh": "Anmeldung erneuern",
  "zones.list": "Räume lesen",
  "zones.state": "Raumstatus",
  "homes.home": "Zuhause lesen",
  "schedule.read": "Zeitplan lesen",
  "schedule.write": "Zeitplan schreiben",
  "Schedule lesen": "Zeitplan lesen",
  "Schedule schreiben": "Zeitplan schreiben",
};

function humanizeCloudLabel(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "Cloud";
  }
  if (CLOUD_LABEL_DE[trimmed]) {
    return CLOUD_LABEL_DE[trimmed];
  }
  // Dotted API ids → last segment as plain words if unknown.
  if (/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/i.test(trimmed)) {
    const last = trimmed.split(".").pop() ?? trimmed;
    return last
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/_/g, " ")
      .replace(/^\w/, (c) => c.toUpperCase());
  }
  return trimmed;
}

function cloudLabel(entry: ProtocolEvent): string {
  const d = entry.detail ?? {};
  const fromDetail =
    (typeof d.groupLabel === "string" && d.groupLabel.trim()) ||
    (typeof d.label === "string" && d.label.trim()) ||
    "";
  if (fromDetail) {
    return humanizeCloudLabel(fromDetail);
  }
  const m = entry.message.match(/^Cloud-(?:Request|Anfrage):\s*(.+?)(?:\s*\(\+\d+\))?$/i);
  if (m?.[1]) {
    return humanizeCloudLabel(m[1]);
  }
  return humanizeCloudLabel(
    entry.message.replace(/^Cloud-(?:Request|Anfrage):\s*/i, "").trim() || "Cloud",
  );
}

/**
 * Everyday title + optional subtitle. Technical type/path stay in Details.
 */
export function presentProtocolEvent(entry: ProtocolEvent): {
  title: string;
  subtitle: string | null;
} {
  const d = entry.detail ?? {};
  const roomLabel =
    (typeof d.roomName === "string" && d.roomName.trim()) ||
    (typeof d.zoneName === "string" && d.zoneName.trim()) ||
    "";

  switch (entry.type) {
    case "polling.zones":
      return {
        title: "Räume aktualisiert",
        subtitle: roomLabel || null,
      };
    case "polling.calendar":
      return {
        title: "Termine geprüft",
        subtitle:
          typeof d.matched === "number" ? `${d.matched} Treffer` : null,
      };
    case "user.navigate": {
      const panel = typeof d.panel === "string" ? d.panel.trim() : "";
      if (panel === "protocol" || /protokoll/i.test(entry.message)) {
        return { title: "Du hast das Protokoll geöffnet", subtitle: null };
      }
      if (panel) {
        return { title: `Du hast „${panel}“ geöffnet`, subtitle: null };
      }
      return { title: "Du hast eine Ansicht geöffnet", subtitle: null };
    }
    case "user.setpoint": {
      const temp =
        typeof d.tempC === "number"
          ? `${d.tempC.toFixed(1)} °C`
          : entry.message.replace(/^Solltemperatur\s*/i, "").trim();
      const dur =
        typeof d.durationMinutes === "number"
          ? `${d.durationMinutes} Min`
          : null;
      return {
        title: temp ? `Solltemperatur auf ${temp}` : "Solltemperatur geändert",
        subtitle: [roomLabel, dur].filter(Boolean).join(" · ") || null,
      };
    }
    case "user.power":
      return {
        title: /aus/i.test(entry.message) ? "Heizung aus" : "Heizung an",
        subtitle: roomLabel || null,
      };
    case "user.resume_schedule":
      return { title: "Zeitplan fortgesetzt", subtitle: roomLabel || null };
    case "user.quick_action": {
      const action = typeof d.action === "string" ? d.action.trim() : "";
      return {
        title: action ? `Schnellaktion: ${action}` : "Schnellaktion",
        subtitle: roomLabel || null,
      };
    }
    case "user.settings":
      return {
        title: entry.message.trim() || "Einstellungen geändert",
        subtitle: null,
      };
    case "quota.request": {
      const label = cloudLabel(entry);
      const used =
        typeof d.used === "number" && typeof d.limit === "number"
          ? `${d.used}/${d.limit} heute`
          : null;
      return {
        title: `Cloud-Anfrage: ${label}`,
        subtitle: used,
      };
    }
    case "quota.near_limit":
    case "quota.blocked": {
      const used =
        typeof d.used === "number" && typeof d.limit === "number"
          ? `${d.used}/${d.limit}`
          : null;
      const rem =
        typeof d.remaining === "number" ? `${d.remaining} übrig` : null;
      return {
        title:
          entry.type === "quota.blocked"
            ? "Cloud-Kontingent aufgebraucht"
            : "Cloud-Kontingent fast voll",
        subtitle: [used, rem].filter(Boolean).join(" · ") || null,
      };
    }
    case "calendar.override_apply": {
      const rule =
        (typeof d.ruleName === "string" && d.ruleName.trim()) ||
        entry.message.replace(/^Termin-Override aktiv:\s*/i, "").trim();
      const mode =
        d.mode === "off" ? "Aus" : d.mode === "heat" ? "Heizen" : null;
      const temp =
        typeof d.targetTempC === "number" ? `${d.targetTempC} °C` : null;
      return {
        title: rule ? `Termin heizt mit: ${rule}` : "Termin heizt mit",
        subtitle: [roomLabel, mode, temp].filter(Boolean).join(" · ") || null,
      };
    }
    case "calendar.override_clear": {
      const rule =
        (typeof d.ruleName === "string" && d.ruleName.trim()) ||
        entry.message.replace(/^Termin-Override beendet:?\s*/i, "").trim();
      return {
        title: rule ? `Termin beendet: ${rule}` : "Termin beendet",
        subtitle: roomLabel || null,
      };
    }
    case "presence.changed": {
      const from =
        typeof d.from === "string" ? presenceWord(d.from) : null;
      const to = typeof d.to === "string" ? presenceWord(d.to) : null;
      if (from && to) {
        return { title: `${from} → ${to}`, subtitle: null };
      }
      return { title: "Zuhause/Unterwegs gewechselt", subtitle: null };
    }
    case "presence.home":
      return {
        title: "Zuhause",
        subtitle: d.initial === true ? "erstmals erkannt" : null,
      };
    case "presence.away":
      return {
        title: "Unterwegs",
        subtitle: d.initial === true ? "erstmals erkannt" : null,
      };
    case "window.open":
    case "window.closed":
      return {
        title: entry.type === "window.open" ? "Fenster offen" : "Fenster zu",
        subtitle: roomLabel || null,
      };
    case "window.auto_off":
      return {
        title: "Heizung wegen Fenster aus",
        subtitle: roomLabel || null,
      };
    case "window.resume":
      return {
        title: "Heizung nach Fenster wieder an",
        subtitle: roomLabel || null,
      };
    case "heatup.started":
    case "heatup.accept":
    case "heatup.reject":
      return {
        title: TYPE_TITLES[entry.type] ?? entry.message,
        subtitle: roomLabel || null,
      };
    case "feedback.error":
      return {
        title: "Etwas ist schiefgelaufen",
        subtitle: entry.message.trim() || null,
      };
    default:
      break;
  }

  // Soften leftover jargon in stored messages.
  let title = entry.message.trim();
  title = title
    .replace(/^Cloud-Request:\s*/i, "Cloud-Anfrage: ")
    .replace(/^Presence:\s*/i, "")
    .replace(/^Termin-Override aktiv:\s*/i, "Termin heizt mit: ")
    .replace(/^Termin-Override beendet:?\s*/i, "Termin beendet: ");
  if (!title || /^[a-z]+\.[a-z_]+$/i.test(title)) {
    title = TYPE_TITLES[entry.type] ?? entry.type;
  }

  const subtitleParts: string[] = [];
  if (roomLabel && !title.includes(roomLabel)) {
    subtitleParts.push(roomLabel);
  }
  if (typeof d.targetTempC === "number") {
    subtitleParts.push(`${d.targetTempC} °C`);
  } else if (typeof d.tempC === "number") {
    subtitleParts.push(`${d.tempC} °C`);
  }
  return {
    title,
    subtitle: subtitleParts.length ? subtitleParts.join(" · ") : null,
  };
}

/**
 * Technical / agent-friendly detail line (method, path, type, leftover keys).
 * Shown under „Details“, not as the main subtitle.
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
    parts.push(`${presenceWord(d.from)} → ${presenceWord(d.to)}`);
  } else if (typeof d.from === "string") {
    parts.push(`von ${presenceWord(d.from)}`);
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
    "open",
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

  // Type always last — agent hint, not the human headline.
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

function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="protocol-filters__group">
      <p className="protocol-filters__group-label">{label}</p>
      <div className="protocol-filters__chips" role="group" aria-label={label}>
        {children}
      </div>
    </div>
  );
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
        Wer etwas getan hat und was passiert ist — in Alltagssprache. Technische
        Details nur bei Bedarf.
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

        <FilterGroup label="Zeitraum">
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
        </FilterGroup>

        <FilterGroup label="Von wem">
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
        </FilterGroup>

        <FilterGroup label="Was passiert ist">
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
        </FilterGroup>

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
  const { title, subtitle } = presentProtocolEvent(entry);
  const detailLine = formatProtocolDetailLine(entry);
  const detailsId = useId();
  // Type-only meta is noise — hide. Anything richer stays behind „Details“.
  const hasUsefulDetails = detailLine !== entry.type;
  const [open, setOpen] = useState(false);

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
        <p className="protocol-row__msg">{title}</p>
        {subtitle ? <p className="protocol-row__sub">{subtitle}</p> : null}
        {hasUsefulDetails ? (
          <>
            <button
              type="button"
              className="protocol-row__details-toggle"
              aria-expanded={open}
              aria-controls={detailsId}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? "Details ausblenden" : "Details"}
            </button>
            {open ? (
              <p className="protocol-row__detail" id={detailsId}>
                {detailLine}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </li>
  );
}
