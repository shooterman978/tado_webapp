/**
 * One-time Tado cloud device-code login for room/zone names (+ later schedule).
 * Control stays on HomeKit; this only fetches metadata.
 *
 * @package @heizplan/web
 */

import { useEffect, useRef, useState } from "react";
import type { CloudAuthStart, CloudStatus, ZoneNamingInfo } from "@heizplan/shared";
import {
  fetchCloudStatus,
  pollCloudAuth,
  startCloudAuth,
  syncCloudHome,
} from "../api";

interface CloudLinkPanelProps {
  naming?: ZoneNamingInfo | null;
  onLinked?: () => void;
}

export function CloudLinkPanel({ naming, onLinked }: CloudLinkPanelProps) {
  const [cloud, setCloud] = useState<CloudStatus | null>(null);
  const [pending, setPending] = useState<CloudAuthStart | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    void fetchCloudStatus()
      .then(setCloud)
      .catch(() => setCloud(null));
    return () => {
      if (pollRef.current != null) {
        window.clearInterval(pollRef.current);
      }
    };
  }, []);

  function stopPoll(): void {
    if (pollRef.current != null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function startPoll(): void {
    stopPoll();
    pollRef.current = window.setInterval(() => {
      void (async () => {
        try {
          const result = await pollCloudAuth();
          if (result.status === "pending") {
            setMessage(result.message);
            return;
          }
          stopPoll();
          setPending(null);
          if (result.status === "linked") {
            setCloud(result.cloud ?? (await fetchCloudStatus()));
            setMessage(result.message);
            setError(null);
            onLinked?.();
            return;
          }
          setError(result.message);
        } catch (err) {
          stopPoll();
          setError(err instanceof Error ? err.message : "Poll fehlgeschlagen");
        }
      })();
    }, 5000);
  }

  async function beginLink(): Promise<void> {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const started = await startCloudAuth();
      setPending(started);
      setMessage("Browser öffnen und bei tado° bestätigen …");
      startPoll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Auth-Start fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  async function resync(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await syncCloudHome();
      setCloud(res.cloud);
      setMessage(
        `Home-Sync ok (${res.homeName}) · Stand ${new Date(res.syncedAt).toLocaleString("de-DE")}`,
      );
      onLinked?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  const linked = cloud?.linked ?? naming?.cloudLinked ?? false;
  const namesOk = naming?.source === "cloud" || naming?.source === "map";

  return (
    <div className="cloud-link">
      <p className="cloud-link__status">
        {linked
          ? `Cloud verknüpft${cloud?.homeName ? `: ${cloud.homeName}` : ""}${
              cloud?.syncedAt
                ? ` · Sync ${new Date(cloud.syncedAt).toLocaleString("de-DE")}`
                : ""
            }`
          : "Cloud nicht verknüpft — Kacheln zeigen HAP-Radiator-Labels."}
      </p>
      {!namesOk ? (
        <p className="cloud-link__hint">
          Einmaliger Device-Code-Login holt Zone-Namen (Büro, Bad, …) und fasst Mehrfach-Thermostate
          pro Raum zusammen. Steuerung bleibt lokal (HomeKit).
        </p>
      ) : null}
      <div className="cloud-link__actions">
        {!linked ? (
          <button type="button" className="cloud-link__btn" disabled={busy} onClick={() => void beginLink()}>
            {busy ? "…" : "Raumnamen mit Tado verknüpfen"}
          </button>
        ) : (
          <button type="button" className="cloud-link__btn" disabled={busy} onClick={() => void resync()}>
            {busy ? "…" : "Home Cloud jetzt syncen"}
          </button>
        )}
      </div>
      {pending ? (
        <div className="cloud-link__pending" role="status">
          <p>
            Code: <strong>{pending.userCode}</strong>
          </p>
          <a href={pending.verificationUriComplete} target="_blank" rel="noreferrer">
            Bei tado° bestätigen (öffnet Browser)
          </a>
          <p className="cloud-link__hint">Gültig ca. {Math.round(pending.expiresIn / 60)} Min. — danach neu starten.</p>
        </div>
      ) : null}
      {message ? <p className="cloud-link__msg">{message}</p> : null}
      {error ? (
        <p className="error-state" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
