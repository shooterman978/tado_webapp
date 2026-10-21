/**
 * Breadcrumb chrome for drill-in screens (single dashboard shell).
 * @package @heizplan/web
 */

import { BackIcon } from "./icons";

export interface PageChromeProps {
  /** Current page label (last crumb). */
  current: string;
  /** Navigate back one level (usually to dashboard). */
  onBack: () => void;
  /** Jump to dashboard root. */
  onHome?: () => void;
  /** Optional root label; default Heizplan. */
  rootLabel?: string;
}

export function PageChrome({
  current,
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
        <li className="page-chrome__crumb page-chrome__crumb--root">
          <button type="button" className="page-chrome__link" onClick={goHome}>
            {rootLabel}
          </button>
        </li>
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
