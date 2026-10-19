/**
 * Home quick actions — Ausschalten + Zeitplan fortsetzen (+ Fenster-Aus).
 * @package @heizplan/web
 */

import { useState } from "react";
import type { Zone } from "@heizplan/shared";
import { runQuickAction, setZonePower } from "../api";
import { PowerIcon, ScheduleResumeIcon, WindowIcon } from "./icons";

interface QuickActionsProps {
  interactive: boolean;
  zones: Zone[];
  onDone: () => void;
}

export function QuickActions({ interactive, zones, onDone }: QuickActionsProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const openWindows = zones.filter((z) => z.windowOpen && z.targetTempC != null);

  async function run(action: "off" | "resume"): Promise<void> {
    if (!interactive) {
      setError("Steuerung nicht verfügbar.");
      return;
    }
    setBusy(action);
    setError(null);
    try {
      await runQuickAction(action);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kurzbefehl fehlgeschlagen");
    } finally {
      setBusy(null);
    }
  }

  async function turnOffOpenWindows(): Promise<void> {
    if (!interactive) {
      setError("Steuerung nicht verfügbar.");
      return;
    }
    setBusy("window");
    setError(null);
    try {
      for (const zone of openWindows) {
        await setZonePower(zone.id, "off");
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fenster-Aus fehlgeschlagen");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="quick-actions" aria-label="Kurzbefehle">
      <div className="quick-actions__row">
        <button
          type="button"
          className="quick-actions__card"
          disabled={Boolean(busy)}
          onClick={() => void run("off")}
        >
          <PowerIcon className="quick-actions__icon" />
          <span className="quick-actions__title">Ausschalten</span>
          <span className="quick-actions__sub">Alle Räume</span>
        </button>
        <button
          type="button"
          className="quick-actions__card quick-actions__card--accent"
          disabled={Boolean(busy)}
          onClick={() => void run("resume")}
        >
          <ScheduleResumeIcon className="quick-actions__icon" />
          <span className="quick-actions__title">Zeitplan fortsetzen</span>
          <span className="quick-actions__sub">Alle Räume</span>
        </button>
      </div>
      {openWindows.length > 0 ? (
        <button
          type="button"
          className="quick-actions__window"
          disabled={Boolean(busy)}
          onClick={() => void turnOffOpenWindows()}
        >
          <WindowIcon />
          <span>
            Heizung ausschalten
            <small>
              {openWindows.length === 1
                ? openWindows[0].name
                : `${openWindows.length} Räume mit offenem Fenster`}
            </small>
          </span>
        </button>
      ) : null}
      {error ? (
        <p className="quick-actions__error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
