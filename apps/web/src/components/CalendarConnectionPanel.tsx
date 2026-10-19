/**
 * CalDAV / iCloud connection form for Settings.
 * App password is write-only — never displayed after save.
 *
 * @package @heizplan/web
 */

import { useEffect, useRef, useState } from "react";
import type { CalendarConnectionStatus } from "@heizplan/shared";
import {
  deleteCalendarConnection,
  fetchCalendarConnection,
  refreshCalendarConnection,
  saveCalendarConnection,
} from "../api";

interface CalendarConnectionPanelProps {
  /** Fired only after user-driven save/refresh/disconnect — not on mount. */
  onChanged?: (status: CalendarConnectionStatus) => void;
}

export function CalendarConnectionPanel({ onChanged }: CalendarConnectionPanelProps) {
  const [status, setStatus] = useState<CalendarConnectionStatus | null>(null);
  const [url, setUrl] = useState("https://caldav.icloud.com");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  useEffect(() => {
    let cancelled = false;
    void fetchCalendarConnection()
      .then((s) => {
        if (cancelled) {
          return;
        }
        setStatus(s);
        if (s.url) {
          setUrl(s.url);
        }
        if (s.username) {
          setUsername(s.username);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "CalDAV-Status laden fehlgeschlagen",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function applyUserChange(s: CalendarConnectionStatus): void {
    setStatus(s);
    if (s.url) {
      setUrl(s.url);
    }
    if (s.username) {
      setUsername(s.username);
    }
    onChangedRef.current?.(s);
  }

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const next = await saveCalendarConnection({
        url: url.trim(),
        username: username.trim(),
        appPassword: password.trim() || undefined,
      });
      setPassword("");
      applyUserChange(next);
      setInfo(
        next.calendars.length > 0
          ? `${next.calendars.length} Kalender gefunden.`
          : "Gespeichert.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Speichern fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  async function refresh(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      applyUserChange(await refreshCalendarConnection());
      setInfo("Kalenderliste aktualisiert.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Aktualisieren fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      applyUserChange(await deleteCalendarConnection());
      setPassword("");
      setInfo("CalDAV-Zugang entfernt.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Trennen fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="calendar-conn">
      <p className="settings__hint settings__hint--inline">
        iCloud: Apple-ID +{" "}
        <strong>App-spezifisches Passwort</strong> (appleid.apple.com → Anmeldung &amp;
        Sicherheit). Nie das normale Apple-Passwort. Zugangsdaten nur im Bridge-Volume
        (`calendar-credentials.json`), nicht in Git.
      </p>

      <label className="calendar-conn__field">
        <span>CalDAV-URL</span>
        <input
          type="url"
          value={url}
          disabled={busy}
          autoComplete="off"
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://caldav.icloud.com"
        />
      </label>
      <label className="calendar-conn__field">
        <span>Apple-ID / Benutzer</span>
        <input
          type="email"
          value={username}
          disabled={busy}
          autoComplete="username"
          onChange={(e) => setUsername(e.target.value)}
          placeholder="name@icloud.com"
        />
      </label>
      <label className="calendar-conn__field">
        <span>
          App-Passwort
          {status?.hasPassword ? " (leer = unverändert)" : ""}
        </span>
        <input
          type="password"
          value={password}
          disabled={busy}
          autoComplete="new-password"
          onChange={(e) => setPassword(e.target.value)}
          placeholder={status?.hasPassword ? "••••••••" : "xxxx-xxxx-xxxx-xxxx"}
        />
      </label>

      <div className="calendar-conn__actions">
        <button type="button" className="settings-quota-save" disabled={busy} onClick={() => void save()}>
          Speichern &amp; prüfen
        </button>
        {status?.configured ? (
          <>
            <button
              type="button"
              className="calendar-conn__secondary"
              disabled={busy}
              onClick={() => void refresh()}
            >
              Kalender laden
            </button>
            <button
              type="button"
              className="calendar-conn__danger"
              disabled={busy}
              onClick={() => void disconnect()}
            >
              Trennen
            </button>
          </>
        ) : null}
      </div>

      {status?.configured ? (
        <p className="settings-row__meta">
          Verbunden
          {status.lastOkAt
            ? ` · zuletzt ok ${new Date(status.lastOkAt).toLocaleString("de-DE")}`
            : ""}
          {status.calendars.length > 0
            ? ` · ${status.calendars.map((c) => c.displayName).join(", ")}`
            : ""}
        </p>
      ) : (
        <p className="settings-row__meta">Noch nicht konfiguriert</p>
      )}
      {status?.lastError ? (
        <p className="error-state" role="alert">
          {status.lastError}
        </p>
      ) : null}
      {error ? (
        <p className="error-state" role="alert">
          {error}
        </p>
      ) : null}
      {info ? (
        <p className="settings__hint" role="status">
          {info}
        </p>
      ) : null}
    </div>
  );
}
