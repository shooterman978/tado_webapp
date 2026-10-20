/**
 * Home automation dashboard — Tado dark look, automation-first.
 * Room tiles stay secondary; everyday control remains in the Tado app.
 *
 * @package @heizplan/web
 */

import type {
  HomePresenceStatus,
  OpenWindowSettings,
  Zone,
} from "@heizplan/shared";

export interface AutomationHomeProps {
  presence: HomePresenceStatus | undefined;
  zones: Zone[];
  openWindow: OpenWindowSettings | null;
  calendarRuleCount: number;
  calendarConfigured: boolean;
  onOpenCalendar: () => void;
  onOpenWindows: () => void;
  onRefreshPresence: () => void;
  presenceBusy?: boolean;
}

function presenceTitle(p: HomePresenceStatus | undefined): string {
  if (!p || p.mode === "unknown") {
    return "Unbekannt";
  }
  return p.mode === "home" ? "Zuhause" : "Unterwegs";
}

function presenceHint(p: HomePresenceStatus | undefined): string {
  if (!p || p.mode === "unknown") {
    return "Status von der Tado-Cloud laden";
  }
  if (p.stale) {
    return "Stand älter — tippen zum Aktualisieren";
  }
  return p.presenceLocked ? "Manuell gesetzt" : "Geofencing / Auto-Assist";
}

function windowSummary(
  zones: Zone[],
  ow: OpenWindowSettings | null,
): { title: string; sub: string; alert: boolean } {
  const open = zones.filter((z) => z.windowOpen);
  if (open.length > 0) {
    return {
      title: open.length === 1 ? `${open[0].name} offen` : `${open.length} Fenster offen`,
      sub:
        ow?.globalAutoOff
          ? "Heizung schaltet dort aus"
          : "Nur Anzeige — Auto-Aus in Einstellungen",
      alert: true,
    };
  }
  if (!ow || ow.detectionEnabled === false) {
    return {
      title: "Fenster aus",
      sub: "Erkennung in Einstellungen einschalten",
      alert: false,
    };
  }
  return {
    title: "Alles zu",
    sub: ow.globalAutoOff ? "Auto-Aus aktiv" : "Nur Anzeige",
    alert: false,
  };
}

export function AutomationHome({
  presence,
  zones,
  openWindow,
  calendarRuleCount,
  calendarConfigured,
  onOpenCalendar,
  onOpenWindows,
  onRefreshPresence,
  presenceBusy = false,
}: AutomationHomeProps) {
  const win = windowSummary(zones, openWindow);

  return (
    <section className="auto-home" aria-label="Automatisierung">
      <p className="auto-home__label">Automatisierung</p>
      <div className="auto-home__grid">
        <button
          type="button"
          className="auto-card auto-card--presence"
          onClick={onRefreshPresence}
          disabled={presenceBusy}
          aria-label={`Home/Away: ${presenceTitle(presence)}. Aktualisieren.`}
        >
          <span className="auto-card__kicker">Geofencing</span>
          <strong className="auto-card__value">{presenceTitle(presence)}</strong>
          <span className="auto-card__sub">
            {presenceBusy ? "Aktualisiere…" : presenceHint(presence)}
          </span>
        </button>

        <button
          type="button"
          className="auto-card auto-card--calendar"
          onClick={onOpenCalendar}
          aria-label="Termine und Heizung"
        >
          <span className="auto-card__kicker">Termine</span>
          <strong className="auto-card__value">
            {calendarRuleCount > 0
              ? `${calendarRuleCount} Regel${calendarRuleCount === 1 ? "" : "n"}`
              : "Einrichten"}
          </strong>
          <span className="auto-card__sub">
            {calendarConfigured
              ? "Kalender · Home/Away-Bedingungen"
              : "iPhone verbinden"}
          </span>
        </button>

        <button
          type="button"
          className={
            win.alert
              ? "auto-card auto-card--window is-alert"
              : "auto-card auto-card--window"
          }
          onClick={onOpenWindows}
          aria-label={`Fenster: ${win.title}`}
        >
          <span className="auto-card__kicker">Fenster</span>
          <strong className="auto-card__value">{win.title}</strong>
          <span className="auto-card__sub">{win.sub}</span>
        </button>

        <button
          type="button"
          className="auto-card auto-card--heatup"
          onClick={onOpenCalendar}
          aria-label="Vorwärmen und Heat-up"
        >
          <span className="auto-card__kicker">Vorwärmen</span>
          <strong className="auto-card__value">Heat-up</strong>
          <span className="auto-card__sub">
            Rechtzeitig warm vor Terminen
          </span>
        </button>
      </div>
      <p className="auto-home__note">
        Alltagstemperaturen stellst du in der Tado-App ein. Heizplan kümmert sich
        um Termine, Fenster, Vorwärmen und Geofencing.
      </p>
    </section>
  );
}
