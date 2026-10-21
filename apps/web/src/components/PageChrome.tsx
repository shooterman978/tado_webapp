/**
 * Breadcrumb chrome for drill-in screens (single dashboard shell).
 * Always renders the full path: Heizplan › … › current.
 * @package @heizplan/web
 */

import { BackIcon } from "./icons";

/** Clickable parent segment between root and current. */
export interface BreadcrumbAncestor {
  label: string;
  onNavigate: () => void;
}

export interface PageChromeProps {
  /** Current page label (last crumb, not clickable). */
  current: string;
  /**
   * Intermediate parents between root and current (full path).
   * Example: System hub child → [{ label: "System", onNavigate: goSystem }].
   */
  ancestors?: BreadcrumbAncestor[];
  /** Navigate back one level. */
  onBack: () => void;
  /** Jump to dashboard root. */
  onHome?: () => void;
  /** Optional root label; default Heizplan. */
  rootLabel?: string;
}

export function PageChrome({
  current,
  ancestors = [],
  onBack,
  onHome,
  rootLabel = "Heizplan",
}: PageChromeProps) {
  const goHome = onHome ?? onBack;
  return (
    <nav className="page-chrome" aria-label="Brotkrumen">
      <button
        type="button"
        className="page-chrome__back icon-btn-ghost"
        onClick={onBack}
        aria-label="Zurück"
      >
        <BackIcon />
      </button>
      <ol className="page-chrome__trail">
        <li className="page-chrome__crumb page-chrome__crumb--nav">
          <button type="button" className="page-chrome__link" onClick={goHome}>
            {rootLabel}
          </button>
        </li>
        {ancestors.map((crumb) => (
          <li
            key={crumb.label}
            className="page-chrome__crumb page-chrome__crumb--nav"
          >
            <button
              type="button"
              className="page-chrome__link"
              onClick={crumb.onNavigate}
            >
              {crumb.label}
            </button>
          </li>
        ))}
        <li
          className="page-chrome__crumb page-chrome__crumb--current"
          aria-current="page"
        >
          <span className="page-chrome__current">{current}</span>
        </li>
      </ol>
    </nav>
  );
}
