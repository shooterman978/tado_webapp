/**
 * Bottom navigation — Zuhause / Einstellungen / Mehr (screenshot 05/03).
 * @package @heizplan/web
 */

import { HomeNavIcon, MenuIcon, SlidersIcon } from "./icons";

export type NavTab = "home" | "settings" | "more";

interface BottomNavProps {
  active: NavTab;
  onChange: (tab: NavTab) => void;
}

export function BottomNav({ active, onChange }: BottomNavProps) {
  return (
    <nav className="bottom-nav" aria-label="Hauptnavigation">
      <button
        type="button"
        className={active === "home" ? "bottom-nav__item is-active" : "bottom-nav__item"}
        onClick={() => onChange("home")}
      >
        <HomeNavIcon />
        <span>Zuhause</span>
      </button>
      <button
        type="button"
        className={active === "settings" ? "bottom-nav__item is-active" : "bottom-nav__item"}
        onClick={() => onChange("settings")}
      >
        <SlidersIcon />
        <span>Einstellungen</span>
      </button>
      <button
        type="button"
        className={active === "more" ? "bottom-nav__item is-active" : "bottom-nav__item"}
        onClick={() => onChange("more")}
      >
        <MenuIcon />
        <span>Mehr</span>
      </button>
    </nav>
  );
}
