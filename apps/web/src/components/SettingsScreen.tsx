/**
 * Settings shell — grouped lists from screenshots 03/04 + open-window (plain language).
 * @package @heizplan/web
 */

import { useEffect, useState, type ReactNode } from "react";
import type {
  CloudQuotaStatus,
  HealthStatus,
  OpenWindowResumeMode,
  OpenWindowSettings,
  ZonesResponse,
} from "@heizplan/shared";
import {
  fetchCloudQuota,
  fetchOpenWindowSettings,
  saveCloudQuotaLimit,
  saveOpenWindowSettings,
} from "../api";
import { CloudLinkPanel } from "./CloudLinkPanel";
import { CloudQuotaBadge, formatQuotaLabel } from "./CloudQuotaBadge";
import { CloudRequestLog } from "./CloudRequestLog";
import { ChevronIcon } from "./icons";

function openWindowSkillMeta(ow: OpenWindowSettings | null): string {
  if (!ow || ow.detectionEnabled === false) {
    return "Aus";
  }
  if (ow.globalAutoOff) {
    return "Heizung aus";
  }
  return "Nur Anzeige";
}

interface SettingsScreenProps {
  health: HealthStatus | null;
  zones: ZonesResponse | null;
  showHumidity: boolean;
  onShowHumidityChange: (value: boolean) => void;
  quota: CloudQuotaStatus | null;
  onQuotaChange: (quota: CloudQuotaStatus) => void;
  quotaLoading?: boolean;
  quotaUnavailable?: string | null;
  onZonesRefresh?: () => void;
  onOpenCalendarRules?: () => void;
}

interface RowProps {
  label: string;
  glyph: string;
  circle?: string;
  trailing?: ReactNode;
  muted?: boolean;
}

function Row({ label, glyph, circle, trailing, muted }: RowProps) {
  return (
    <div className={muted ? "settings-row is-muted" : "settings-row"}>
      {circle ? (
        <span className="settings-row__circle" style={{ background: circle }} aria-hidden="true">
          {glyph}
        </span>
      ) : (
        <span className="settings-row__icon" aria-hidden="true">
          {glyph}
        </span>
      )}
      <span className="settings-row__label">{label}</span>
      {trailing ?? <ChevronIcon className="settings-row__chev" />}
    </div>
  );
}

export function SettingsScreen({
  health,
  zones,
  showHumidity,
  onShowHumidityChange,
  quota,
  onQuotaChange,
  quotaLoading = false,
  quotaUnavailable = null,
  onZonesRefresh,
  onOpenCalendarRules,
}: SettingsScreenProps) {
  const [ow, setOw] = useState<OpenWindowSettings | null>(null);
  const [owError, setOwError] = useState<string | null>(null);
  const [owBusy, setOwBusy] = useState(false);
  const [limitDraft, setLimitDraft] = useState("");
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const [quotaBusy, setQuotaBusy] = useState(false);

  useEffect(() => {
    void fetchOpenWindowSettings()
      .then(setOw)
      .catch((err: unknown) => {
        setOwError(err instanceof Error ? err.message : "Einstellungen laden fehlgeschlagen");
      });
    void fetchCloudQuota()
      .then((q) => {
        onQuotaChange(q);
        setLimitDraft(String(q.limit));
      })
      .catch(() => {
        /* badge stays empty */
      });
  }, [onQuotaChange]);

  useEffect(() => {
    if (quota) {
      setLimitDraft(String(quota.limit));
    }
  }, [quota?.limit]);

  async function patchOw(next: Partial<OpenWindowSettings>): Promise<void> {
    if (!ow) {
      return;
    }
    setOwBusy(true);
    setOwError(null);
    try {
      const saved = await saveOpenWindowSettings({ ...ow, ...next });
      setOw(saved);
    } catch (err) {
      setOwError(err instanceof Error ? err.message : "Speichern fehlgeschlagen");
    } finally {
      setOwBusy(false);
    }
  }

  function setRoomAutoOff(zoneId: string, autoOff: boolean): void {
    if (!ow) {
      return;
    }
    void patchOw({
      rooms: {
        ...ow.rooms,
        [zoneId]: { ...ow.rooms[zoneId], autoOff },
      },
    });
  }

  function setResumeMode(resumeMode: OpenWindowResumeMode): void {
    void patchOw({ resumeMode });
  }

  return (
    <div className="settings">
      <h1 className="settings__title">Einstellungen</h1>

      <p className="settings__section-label">Termine &amp; Heizung</p>
      <div className="settings-group settings-group--feature">
        <button
          type="button"
          className="settings-row settings-row--button settings-row--feature"
          onClick={onOpenCalendarRules}
          aria-label="Termine und Heizung einrichten"
        >
          <span className="settings-row__circle" style={{ background: "#c0392b" }} aria-hidden="true">
            K
          </span>
          <span className="settings-row__label">
            Termine steuern die Heizung
            <small className="settings-row__sub">
              Assistent · iPhone-Kalender · Schritt für Schritt
            </small>
          </span>
          <span className="settings-row__meta">Öffnen</span>
          <ChevronIcon className="settings-row__chev" />
        </button>
      </div>

      <p className="settings__section-label">Fenster offen</p>
      <div className="settings-group settings-group--window">
        <div className="settings-explain" role="note">
          <strong>Was passiert?</strong>
          <span>
            Wenn ein Fenster offen ist, siehst du es am Raum. Optional schaltet die Heizung
            dort aus — und wieder ein, sobald das Fenster zu ist.
          </span>
        </div>

        <label className="settings-row settings-row--toggle">
          <span className="settings-row__circle" style={{ background: "#5dade2" }} aria-hidden="true">
            F
          </span>
          <span className="settings-row__label">
            Fenster erkennen
            <small className="settings-row__sub">Anzeige auf der Startseite und im Raum</small>
          </span>
          <input
            type="checkbox"
            checked={ow?.detectionEnabled !== false}
            disabled={!ow || owBusy}
            onChange={(e) => void patchOw({ detectionEnabled: e.target.checked })}
          />
        </label>

        <label
          className={
            ow?.detectionEnabled === false
              ? "settings-row settings-row--toggle is-muted"
              : "settings-row settings-row--toggle"
          }
        >
          <span className="settings-row__circle" style={{ background: "#1b5e54" }} aria-hidden="true">
            H
          </span>
          <span className="settings-row__label">
            Heizung automatisch ausschalten
            <small className="settings-row__sub">
              Nur in Räumen mit offenem Fenster — spart Energie
            </small>
          </span>
          <input
            type="checkbox"
            checked={ow?.globalAutoOff ?? false}
            disabled={!ow || owBusy || ow.detectionEnabled === false}
            onChange={(e) => void patchOw({ globalAutoOff: e.target.checked })}
          />
        </label>

        {ow && ow.detectionEnabled !== false && ow.globalAutoOff ? (
          <div className="settings-rooms">
            <p className="settings-rooms__label">In diesen Räumen</p>
            {(zones?.zones ?? []).length === 0 ? (
              <p className="settings__hint settings__hint--inline">Noch keine Räume geladen.</p>
            ) : (
              (zones?.zones ?? []).map((zone) => {
                const room = ow.rooms[zone.id];
                const effective =
                  typeof room?.autoOff === "boolean" ? room.autoOff : true;
                return (
                  <label key={zone.id} className="settings-row settings-row--toggle">
                    <span className="settings-row__icon" aria-hidden="true">
                      ·
                    </span>
                    <span className="settings-row__label">
                      {zone.name}
                      {zone.windowOpen ? (
                        <small className="settings-row__sub">gerade offen</small>
                      ) : null}
                    </span>
                    <input
                      type="checkbox"
                      checked={effective}
                      disabled={owBusy}
                      onChange={(e) => setRoomAutoOff(zone.id, e.target.checked)}
                    />
                  </label>
                );
              })
            )}
          </div>
        ) : null}

        <details className="settings-advanced">
          <summary>Erweitert</summary>
          <p className="settings-advanced__hint">
            Für Technik-Interessierte. Im Alltag reichen die Schalter oben.
          </p>
          <fieldset className="settings-resume" disabled={!ow || owBusy}>
            <legend className="settings-resume__legend">
              Wenn das Fenster wieder zu ist
            </legend>
            <label className="settings-resume__option">
              <input
                type="radio"
                name="resumeMode"
                checked={ow?.resumeMode !== "clear_overlay"}
                onChange={() => setResumeMode("restore_setpoint")}
              />
              <span>
                Frühere Temperatur wieder einstellen
                <small>Empfohlen — so warm wie vorher</small>
              </span>
            </label>
            <label className="settings-resume__option">
              <input
                type="radio"
                name="resumeMode"
                checked={ow?.resumeMode === "clear_overlay"}
                onChange={() => setResumeMode("clear_overlay")}
              />
              <span>
                Dem Zeitplan folgen
                <small>Heizung wie im normalen Tagesplan</small>
              </span>
            </label>
          </fieldset>
        </details>
      </div>
      {owError ? (
        <p className="error-state" role="alert">
          {owError}
        </p>
      ) : null}

      <p className="settings__section-label">Zuhause</p>
      <div className="settings-group">
        <Row label="Räume & Geräte" glyph="R" />
        <Row
          label="Bridge & Pairing"
          glyph="B"
          trailing={
            <span className="settings-row__meta">
              {health?.bridge.paired ? "Gepaart" : health?.bridge.state ?? "—"}
            </span>
          }
        />
        <Row
          label="Raumnamen"
          glyph="N"
          trailing={
            <span className="settings-row__meta">{zones?.naming?.source ?? "none"}</span>
          }
        />
        <Row label="Personen" glyph="P" muted />
      </div>

      <p className="settings__section-label">Cloud / Raumnamen</p>
      <div className="settings-group settings-group--quota">
        <CloudLinkPanel naming={zones?.naming} onLinked={onZonesRefresh} />
      </div>

      <p className="settings__section-label">Cloud-Quota</p>
      <div className="settings-group settings-group--quota">
        <CloudQuotaBadge
          quota={quota}
          loading={quotaLoading}
          unavailableReason={quotaUnavailable}
        />
        <p className="settings__hint settings__hint--inline">
          Zählt alle Anfragen an die Tado-Cloud (Namen, Zeitplan, Fenster). Reset Mitternacht
          Europe/Berlin
          {quota
            ? ` · ${new Date(quota.resetsAt).toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}`
            : ""}
          .
        </p>
        {quota ? (
          <p className="settings-row__meta settings-quota-line">{formatQuotaLabel(quota)}</p>
        ) : null}
        <label className="settings-row settings-row--limit">
          <span className="settings-row__label">Tageslimit</span>
          <input
            type="number"
            min={1}
            max={10000}
            value={limitDraft}
            disabled={quotaBusy}
            onChange={(e) => setLimitDraft(e.target.value)}
          />
          <button
            type="button"
            className="settings-quota-save"
            disabled={quotaBusy}
            onClick={() => {
              const n = Number(limitDraft);
              if (!Number.isFinite(n)) {
                setQuotaError("Ungültiges Limit");
                return;
              }
              setQuotaBusy(true);
              setQuotaError(null);
              void saveCloudQuotaLimit(n)
                .then((q) => {
                  onQuotaChange(q);
                  setLimitDraft(String(q.limit));
                })
                .catch((err: unknown) => {
                  setQuotaError(
                    err instanceof Error ? err.message : "Limit speichern fehlgeschlagen",
                  );
                })
                .finally(() => setQuotaBusy(false));
            }}
          >
            Speichern
          </button>
        </label>
        {quotaError ? (
          <p className="error-state" role="alert">
            {quotaError}
          </p>
        ) : null}
      </div>

      <p className="settings__section-label">Cloud-Requests</p>
      <div className="settings-group settings-group--quota">
        <CloudRequestLog />
      </div>

      <p className="settings__section-label">Skills</p>
      <div className="settings-group">
        <Row label="Auto-Assist" glyph="A" circle="#1b5e54" muted />
        <Row label="Geofencing" glyph="G" circle="#2f6fed" muted />
        <Row label="Energy IQ" glyph="E" circle="#7cb342" muted />
        <Row
          label="Fenster offen"
          glyph="F"
          circle="#5dade2"
          trailing={
            <span className="settings-row__meta">{openWindowSkillMeta(ow)}</span>
          }
        />
        <Row
          label="Intelligenter Zeitplan"
          glyph="Z"
          circle="#e67e22"
          trailing={<span className="settings-row__meta">Cloud-Sync</span>}
        />
        <button
          type="button"
          className="settings-row settings-row--button"
          onClick={onOpenCalendarRules}
        >
          <span className="settings-row__circle" style={{ background: "#c0392b" }} aria-hidden="true">
            K
          </span>
          <span className="settings-row__label">Termine &amp; Heizung</span>
          <span className="settings-row__meta">Assistent</span>
          <ChevronIcon className="settings-row__chev" />
        </button>
        <Row label="Raumluft-Komfort" glyph="L" circle="#1abc9c" muted />
      </div>

      <p className="settings__section-label">Darstellung</p>
      <div className="settings-group">
        <label className="settings-row settings-row--toggle">
          <span className="settings-row__icon" aria-hidden="true">
            D
          </span>
          <span className="settings-row__label">Luftfeuchtigkeit anzeigen</span>
          <input
            type="checkbox"
            checked={showHumidity}
            onChange={(e) => onShowHumidityChange(e.target.checked)}
          />
        </label>
      </div>

      <p className="settings__hint">
        Steuerung lokal (HomeKit). Termine optional über iPhone-Kalender. Produktname: Heizplan.
      </p>
    </div>
  );
}
