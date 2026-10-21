/**
 * Global CloudQuota badge — all Tado cloud HTTP (not schedule-only).
 * Always visible (placeholder when API/quota unavailable) so the UI never
 * silently hides the budget.
 *
 * @package @heizplan/web
 */

import type { CloudQuotaStatus } from "@heizplan/shared";

interface CloudQuotaBadgeProps {
  quota: CloudQuotaStatus | null;
  /** True while the first quota fetch is in flight. */
  loading?: boolean;
  /** Set when GET /api/cloud/quota failed (old API image, offline, …). */
  unavailableReason?: string | null;
  compact?: boolean;
}

export function formatQuotaLabel(quota: CloudQuotaStatus): string {
  return `Heute: ${quota.used} / ${quota.limit} Cloud-Anfragen`;
}

export function CloudQuotaBadge({
  quota,
  loading = false,
  unavailableReason = null,
  compact = false,
}: CloudQuotaBadgeProps) {
  if (!quota) {
    const label = loading
      ? compact
        ? "…"
        : "Cloud-Anfragen: laden …"
      : compact
        ? "—/—"
        : unavailableReason
          ? `Cloud-Anfragen: nicht verfügbar (${unavailableReason})`
          : "Cloud-Anfragen: nicht verfügbar";
    return (
      <div className="cloud-quota-badge is-unavailable" role="status">
        <span className="cloud-quota-badge__label">{label}</span>
      </div>
    );
  }
  const className = [
    "cloud-quota-badge",
    quota.blocked ? "is-blocked" : "",
    quota.nearLimit ? "is-near" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const resetHint = (() => {
    try {
      return new Date(quota.resetsAt).toLocaleTimeString("de-DE", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Berlin",
      });
    } catch {
      return "00:00";
    }
  })();

  return (
    <div
      className={className}
      role="status"
      title={`Reset Mitternacht Europe/Berlin (~${resetHint}). remaining=${quota.remaining}`}
    >
      <span className="cloud-quota-badge__label">
        {compact ? `${quota.used}/${quota.limit}` : formatQuotaLabel(quota)}
      </span>
      {quota.blocked ? (
        <span className="cloud-quota-badge__warn">Limit erreicht</span>
      ) : quota.nearLimit ? (
        <span className="cloud-quota-badge__warn">nahe Limit</span>
      ) : null}
    </div>
  );
}
