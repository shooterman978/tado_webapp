/**
 * Home-level cloud sync — manual button + optional 4h auto trigger.
 * Does not pull room schedules (those stay behind the schedule sync button).
 *
 * @package @heizplan/web
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { CloudQuotaStatus, CloudSyncStatus } from "@heizplan/shared";
import { ApiError, fetchCloudSyncStatus, syncCloudHome } from "../api";

interface HomeCloudSyncProps {
  onSynced?: () => void;
  onQuotaChange?: (quota: CloudQuotaStatus) => void;
}

function formatSyncedAt(iso: string | null): string {
  if (!iso) {
    return "noch nie";
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return "unbekannt";
  }
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function HomeCloudSync({ onSynced, onQuotaChange }: HomeCloudSyncProps) {
  const [sync, setSync] = useState<CloudSyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const autoRanRef = useRef(false);

  const refreshStatus = useCallback(async () => {
    try {
      const status = await fetchCloudSyncStatus();
      setSync(status);
      return status;
    } catch {
      setSync(null);
      return null;
    }
  }, []);

  const runSync = useCallback(
    async (reason: "manual" | "auto") => {
      setBusy(true);
      setError(null);
      setMessage(null);
      try {
        const res = await syncCloudHome();
        setSync(res.sync);
        onQuotaChange?.(res.quota);
        setMessage(
          reason === "auto"
            ? `Auto-Sync (${res.sync.autoSyncHours} h) · ${res.homeName}`
            : `Cloud synchronisiert · ${res.homeName}`,
        );
        onSynced?.();
      } catch (err) {
        if (err instanceof ApiError && err.quota) {
          onQuotaChange?.(err.quota);
        }
        setError(err instanceof Error ? err.message : "Cloud-Sync fehlgeschlagen");
      } finally {
        setBusy(false);
      }
    },
    [onQuotaChange, onSynced],
  );

  useEffect(() => {
    void (async () => {
      const status = await refreshStatus();
      if (
        status?.linked &&
        status.autoSyncDue &&
        !autoRanRef.current &&
        !busy
      ) {
        autoRanRef.current = true;
        await runSync("auto");
      }
    })();
    // Intentionally once on mount — auto-sync is a clear, infrequent trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (sync && !sync.linked) {
    return null;
  }

  return (
    <div className="home-sync" role="region" aria-label="Cloud-Sync">
      <div className="home-sync__row">
        <div className="home-sync__meta">
          <strong>Cloud-Sync</strong>
          <span>
            Zuletzt {formatSyncedAt(sync?.lastSyncedAt ?? null)}
            {sync ? ` · Auto alle ${sync.autoSyncHours} h` : ""}
          </span>
        </div>
        <button
          type="button"
          className="home-sync__btn"
          disabled={busy || !sync?.linked}
          onClick={() => void runSync("manual")}
        >
          {busy ? "…" : "Jetzt syncen"}
        </button>
      </div>
      {message ? <p className="home-sync__msg">{message}</p> : null}
      {error ? (
        <p className="error-state" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
