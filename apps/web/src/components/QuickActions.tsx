/**
 * Home quick actions — Ausschalten + Zeitplan fortsetzen (screenshot 05).
 * @package @heizplan/web
 */

import { useState } from "react";
import { runQuickAction } from "../api";
import { PowerIcon, ScheduleResumeIcon } from "./icons";

interface QuickActionsProps {
  interactive: boolean;
  onDone: () => void;
}

export function QuickActions({ interactive, onDone }: QuickActionsProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: "off" | "resume"): Promise<void> {
    if (!interactive) {
      setError("Nur bei gepaarter Bridge verfügbar (Fixtures: Layout-only).");
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
      {error ? (
        <p className="quick-actions__error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
