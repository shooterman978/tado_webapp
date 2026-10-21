/**
 * Structured empty / offline / error panel for demo-safe UX.
 * @package @heizplan/web
 */

import type { ReactNode } from "react";

export interface EmptyStateProps {
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: "neutral" | "danger" | "offline";
  icon?: ReactNode;
  role?: "status" | "alert";
}

export function EmptyState({
  title,
  body,
  actionLabel,
  onAction,
  tone = "neutral",
  icon,
  role = "status",
}: EmptyStateProps) {
  return (
    <div
      className={`empty-panel empty-panel--${tone}`}
      role={role}
    >
      {icon ? (
        <span className="empty-panel__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <strong className="empty-panel__title">{title}</strong>
      {body ? <p className="empty-panel__body">{body}</p> : null}
      {actionLabel && onAction ? (
        <button type="button" className="empty-panel__action" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
