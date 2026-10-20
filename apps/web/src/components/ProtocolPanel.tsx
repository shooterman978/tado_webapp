/**
 * Heizplan › Protokoll — filterable event log drill-in.
 * @package @heizplan/web
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ProtocolEvent,
  ProtocolEventCategory,
  ProtocolEventsResponse,
} from "@heizplan/shared";
import { fetchProtocolEvents, postProtocolClientEvent } from "../api";
import { PageChrome } from "./PageChrome";

export interface ProtocolPanelProps {
  onBack: () => void;
  onHome?: () => void;
  /** Open Cloud & Quota for the detailed request log (no duplicate UX). */
  onOpenCloud?: () => void;
}

const CATEGORY_LABELS: Record<ProtocolEventCategory | "all", string> = {
  all: "Alle",
  polling: "Polling",
  user: "Bedienung",
  feedback: "Feedback",
  calendar: "Termine",
  presence: "Presence",
  quota: "Quota",
  window: "Fenster",
  heatup: "Heat-up",
  schedule: "Zeitplan",
  bridge: "Bridge",
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

type RangePreset = "today" | "24h" | "7d" | "all";

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

function rangeBounds(preset: RangePreset): {
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

export function ProtocolPanel({
  onBack,
  onHome,
  onOpenCloud,
}: ProtocolPanelProps) {
  const [category, setCategory] = useState<ProtocolEventCategory | "all">("all");
  const [range, setRange] = useState<RangePreset>("today");
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
  }, [category, range, search]);

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
    if (search || category !== "all" || range !== "all") {
      return "Keine Einträge für diese Filter.";
    }
    return "Noch keine Ereignisse — Automationen und Bedienung füllen das Protokoll.";
  }, [busy, entries.length, search, category, range]);

  return (
    <div className="dash-panel protocol-panel">
      <PageChrome current="Protokoll" onBack={onBack} onHome={onHome} />

      <p className="settings__hint settings__hint--inline">
        Was die Automationen und die App getan haben — ohne Secrets. Detaillierte
        Cloud-Request-Zählung bleibt unter Cloud &amp; Quota.
      </p>

      {onOpenCloud ? (
        <button
          type="button"
          className="protocol-panel__cloud-link"
          onClick={onOpenCloud}
        >
          Cloud-Request-Log öffnen
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
        <p className="error-state" role="alert">
          {error}
        </p>
      ) : null}

      {emptyHint ? <p className="cloud-log__empty">{emptyHint}</p> : null}

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
          <span className="protocol-row__cat" style={{ color: tone }}>
            {CATEGORY_LABELS[entry.category]}
          </span>
        </div>
        <p className="protocol-row__msg">{entry.message}</p>
        <p className="protocol-row__meta">
          {entry.type}
          {entry.roomId ? ` · ${entry.roomId}` : ""}
        </p>
      </div>
    </li>
  );
}
