/**
 * Settings list of counted cloud HTTP calls (explains +3 sync jumps).
 * @package @heizplan/web
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CloudQuotaLogEntry, CloudQuotaLogResponse } from "@heizplan/shared";
import { fetchCloudQuotaLog } from "../api";

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: "Europe/Berlin",
    });
  } catch {
    return iso;
  }
}

function shortPath(path: string): string {
  // Drop /api/v2 prefix noise if present; keep meaningful tail.
  return path.replace(/^\/api\/v2/, "") || path;
}

export function CloudRequestLog() {
  const [data, setData] = useState<CloudQuotaLogResponse | null>(null);
  const [todayOnly, setTodayOnly] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetchCloudQuotaLog({ todayOnly, limit: 100 });
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Log laden fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }, [todayOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => {
    const entries = data?.entries ?? [];
    const out: Array<
      | { kind: "group"; groupId: string; label: string; entries: CloudQuotaLogEntry[] }
      | { kind: "single"; entry: CloudQuotaLogEntry }
    > = [];
    const seen = new Set<string>();
    for (const entry of entries) {
      if (entry.groupId) {
        if (seen.has(entry.groupId)) {
          continue;
        }
        seen.add(entry.groupId);
        const siblings = entries.filter((e) => e.groupId === entry.groupId);
        // Keep chronological within group (API returns newest first overall).
        siblings.sort(
          (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
        );
        out.push({
          kind: "group",
          groupId: entry.groupId,
          label: entry.groupLabel ?? "Gruppe",
          entries: siblings,
        });
      } else {
        out.push({ kind: "single", entry });
      }
    }
    return out;
  }, [data?.entries]);

  return (
    <div className="cloud-log">
      <div className="cloud-log__toolbar">
        <label className="cloud-log__toggle">
          <input
            type="checkbox"
            checked={todayOnly}
            onChange={(e) => setTodayOnly(e.target.checked)}
          />
          Nur heute
        </label>
        <button
          type="button"
          className="cloud-log__refresh"
          disabled={busy}
          onClick={() => void load()}
        >
          {busy ? "…" : "Aktualisieren"}
        </button>
      </div>
      <p className="settings__hint settings__hint--inline">
        Jeder Eintrag = +1 Quota. Schedule-Lesen ist oft eine Gruppe aus 3 Calls
        (activeTimetable + blocks + away).
        {data
          ? ` Buffer: ${data.retained}/${data.maxRetained}.`
          : ""}
      </p>
      {error ? (
        <p className="error-state" role="alert">
          {error}
        </p>
      ) : null}
      {!error && groups.length === 0 ? (
        <p className="cloud-log__empty">Noch keine Cloud-Requests geloggt.</p>
      ) : null}
      <ul className="cloud-log__list">
        {groups.map((item) => {
          if (item.kind === "single") {
            const e = item.entry;
            return (
              <li key={e.id} className="cloud-log__item">
                <span className="cloud-log__time">{formatTime(e.at)}</span>
                <span className="cloud-log__delta">+{e.delta}</span>
                <span className="cloud-log__label">{e.label}</span>
                <span className="cloud-log__meta">
                  {e.method} {shortPath(e.path)}
                </span>
              </li>
            );
          }
          const total = item.entries.reduce((s, e) => s + e.delta, 0);
          const first = item.entries[0];
          return (
            <li key={item.groupId} className="cloud-log__group">
              <header className="cloud-log__group-head">
                <span className="cloud-log__time">
                  {first ? formatTime(first.at) : "—"}
                </span>
                <span className="cloud-log__delta">+{total}</span>
                <span className="cloud-log__label">{item.label}</span>
                <span className="cloud-log__meta">{item.entries.length} Calls</span>
              </header>
              <ul className="cloud-log__sub">
                {item.entries.map((e) => (
                  <li key={e.id}>
                    <span className="cloud-log__time">{formatTime(e.at)}</span>
                    <span className="cloud-log__delta">+{e.delta}</span>
                    <span className="cloud-log__label">{e.label}</span>
                    <span className="cloud-log__meta">
                      {e.method} {shortPath(e.path)}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
