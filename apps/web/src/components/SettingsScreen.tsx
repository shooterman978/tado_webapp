/**
 * Settings shell — grouped lists from screenshots 03/04 + open-window auto-off.
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
import { ChevronIcon } from "./icons";

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
          Zählt alle Cloud-HTTP-Calls (Metadaten, Schedule, openWindow, Auth). Reset Mitternacht
          Europe/Berlin
          {quota
            ? ` · ${new Date(quota.resetsAt).toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}`
            : ""}
          . Unabhängig von Cloud-Login (Zähler lokal). Endpoint: GET /api/cloud/quota.
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

      <p className="settings__section-label">Fenster offen</p>
      <div className="settings-group">
        <label className="settings-row settings-row--toggle">
          <span className="settings-row__circle" style={{ background: "#5dade2" }} aria-hidden="true">
            F
          </span>
          <span className="settings-row__label">
            Bei offenem Fenster Heizung automatisch ausschalten
          </span>
          <input
            type="checkbox"
            checked={ow?.globalAutoOff ?? false}
            disabled={!ow || owBusy}
            onChange={(e) => void patchOw({ globalAutoOff: e.target.checked })}
          />
        </label>
        <fieldset className="settings-resume" disabled={!ow || owBusy}>
          <legend className="settings-resume__legend">Nach Schließen wiederherstellen</legend>
          <label className="settings-resume__option">
            <input
              type="radio"
              name="resumeMode"
              checked={ow?.resumeMode !== "clear_overlay"}
              onChange={() => setResumeMode("restore_setpoint")}
            />
            <span>
              Vorherigen Soll wiederherstellen
              <small>Default — speichert Zieltemperatur vor Auto-Aus</small>
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
              Zeitplan fortsetzen
              <small>Overlay clear / HAP Schedule-Approximation</small>
            </span>
          </label>
        </fieldset>
        {(zones?.zones ?? []).map((zone) => {
          const room = ow?.rooms[zone.id];
          const effective =
            typeof room?.autoOff === "boolean" ? room.autoOff : Boolean(ow?.globalAutoOff);
          return (
            <label key={zone.id} className="settings-row settings-row--toggle">
              <span className="settings-row__icon" aria-hidden="true">
                ·
              </span>
              <span className="settings-row__label">
                {zone.name}
                {zone.windowOpen ? " · offen" : ""}
              </span>
              <input
                type="checkbox"
                checked={effective}
                disabled={!ow || owBusy}
                onChange={(e) => setRoomAutoOff(zone.id, e.target.checked)}
              />
            </label>
          );
        })}
      </div>
      {owError ? (
        <p className="error-state" role="alert">
          {owError}
        </p>
      ) : null}
      <p className="settings__hint">
        Lokal ohne Auto-Assist-Paywall. Erkennung: HAP ContactSensor (falls vorhanden), optional
        Cloud <code>openWindowDetected</code>, sonst Fixture/manuell via API. Resume-Default:
        vorherigen Soll.
      </p>

      <p className="settings__section-label">Skills</p>
      <div className="settings-group">
        <Row label="Auto-Assist" glyph="A" circle="#1b5e54" muted />
        <Row label="Geofencing" glyph="G" circle="#2f6fed" muted />
        <Row label="Energy IQ" glyph="E" circle="#7cb342" muted />
        <Row
          label="Fenster-Offen-Erkennung"
          glyph="F"
          circle="#5dade2"
          trailing={
            <span className="settings-row__meta">
              {ow?.globalAutoOff ? "Auto-Aus an" : "Aktiv"}
            </span>
          }
        />
        <Row
          label="Intelligenter Zeitplan"
          glyph="Z"
          circle="#e67e22"
          trailing={<span className="settings-row__meta">Cloud-Sync</span>}
        />
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
        Steuerung lokal (HomeKit). Kein Kalender/Learning. Produktname: Heizplan.
      </p>
    </div>
  );
}
