/**
 * Cloud link, quota and request log (dashboard drill-in).
 * @package @heizplan/web
 */

import { useEffect, useState } from "react";
import type { CloudQuotaStatus, ZoneNamingInfo } from "@heizplan/shared";
import { fetchCloudQuota, saveCloudQuotaLimit } from "../api";
import { CloudLinkPanel } from "./CloudLinkPanel";
import { CloudQuotaBadge, formatQuotaLabel } from "./CloudQuotaBadge";
import { CloudRequestLog } from "./CloudRequestLog";
import { HomeCloudSync } from "./HomeCloudSync";
import { PageChrome } from "./PageChrome";

export interface CloudPanelProps {
  naming?: ZoneNamingInfo | null;
  quota: CloudQuotaStatus | null;
  quotaLoading?: boolean;
  quotaUnavailable?: string | null;
  onQuotaChange: (quota: CloudQuotaStatus) => void;
  onLinked?: () => void;
  onSynced?: () => void;
  onBack: () => void;
  onHome?: () => void;
  /** Cross-link to Heizplan › Protokoll (agent events; not the request log). */
  onOpenProtocol?: () => void;
}

export function CloudPanel({
  naming,
  quota,
  quotaLoading = false,
  quotaUnavailable = null,
  onQuotaChange,
  onLinked,
  onSynced,
  onBack,
  onHome,
  onOpenProtocol,
}: CloudPanelProps) {
  const [limitDraft, setLimitDraft] = useState("");
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const [quotaBusy, setQuotaBusy] = useState(false);

  useEffect(() => {
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

  return (
    <div className="dash-panel">
      <PageChrome current="Cloud & Quota" onBack={onBack} onHome={onHome} />

      <p className="settings__section-label">Raumnamen</p>
      <div className="settings-group settings-group--quota">
        <CloudLinkPanel naming={naming} onLinked={onLinked} />
      </div>

      <p className="settings__section-label">Sync &amp; Tageskontingent</p>
      <div className="settings-group settings-group--quota">
        <HomeCloudSync onSynced={onSynced} onQuotaChange={onQuotaChange} />
        <CloudQuotaBadge
          quota={quota}
          loading={quotaLoading}
          unavailableReason={quotaUnavailable}
        />
        <p className="settings__hint settings__hint--inline">
          Zählt alle Anfragen an die Tado-Cloud (Namen, Zeitplan, Fenster, Geofencing). Reset
          Mitternacht Europe/Berlin
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
        <p className="settings__hint settings__hint--inline">
          Jeder gezählte Cloud-HTTP-Call (+1 Quota). Automationen und Bedienung
          stehen im Protokoll — hier nur die Request-Zählung.
        </p>
        {onOpenProtocol ? (
          <button
            type="button"
            className="protocol-panel__cloud-link"
            onClick={onOpenProtocol}
          >
            Automations-Protokoll öffnen
            <span aria-hidden="true">→</span>
          </button>
        ) : null}
        <CloudRequestLog />
      </div>
    </div>
  );
}
