/**
 * Tado-style temperature: large whole number + stacked ° / .decimal.
 * @package @heizplan/web
 */

import { splitTemp } from "../lib/zoneDisplay";

interface TempDisplayProps {
  value: number | null;
  /** Visual size variant. */
  size?: "tile" | "detail";
  className?: string;
  /** When true, show "Aus" instead of a number. */
  off?: boolean;
}

export function TempDisplay({
  value,
  size = "tile",
  className,
  off = false,
}: TempDisplayProps) {
  if (off) {
    return (
      <span className={["temp-display", `temp-display--${size}`, "is-off", className].filter(Boolean).join(" ")}>
        Aus
      </span>
    );
  }

  const { whole, frac } = splitTemp(value);

  return (
    <span
      className={["temp-display", `temp-display--${size}`, className].filter(Boolean).join(" ")}
      aria-hidden="true"
    >
      <span className="temp-display__whole">{whole}</span>
      {frac != null ? (
        <span className="temp-display__stack">
          <span className="temp-display__deg">°</span>
          <span className="temp-display__frac">.{frac}</span>
        </span>
      ) : (
        <span className="temp-display__stack">
          <span className="temp-display__deg">°</span>
        </span>
      )}
    </span>
  );
}
