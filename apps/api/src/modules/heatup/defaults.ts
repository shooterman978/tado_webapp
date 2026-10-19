/**
 * Default thresholds for heat-up learning (local, explainable).
 * Model 0 / Model 3 defaults align with math-playground + Comfort-Start patterns.
 *
 * @package @heizplan/api
 */

export const HEATUP_DEFAULTS = {
  /** Minimum ΔT (°C) to start capturing a heat-up session. */
  minDeltaC: 0.5,
  /** Ist within this of Soll counts as reached (Arrival-Stop). */
  reachToleranceC: 0.3,
  /** Sessions shorter than this are rejected as noise. */
  minDurationMinutes: 2,
  /** Sessions longer than this without reach → stalled. */
  maxDurationMinutes: 240,
  /** Soll change ≥ this aborts / rejects the session. */
  targetChangeAbortC: 0.5,
  /** Outdoor bucket width (°C) — debug / optional sanity only. */
  outdoorBucketC: 5,
  /** ΔT bucket width (°C). */
  deltaBucketC: 1,
  /** Minimum ok samples before room-detail UI shows a learned recommendation. */
  minSamplesForUi: 3,
  /** Minimum ok samples before Model 3 OLS is eligible. */
  minSamplesForModel3: 7,
  /** Stall: less than this rise over stallWindowMinutes → reject. */
  stallRiseC: 0.2,
  stallWindowMinutes: 20,
  /** Model 0 EMA learning weight α. */
  emaAlpha: 0.3,
  /** Asymmetric bias minutes (prefer slightly early). */
  offsetMin: 3,
  /** Fallback preheat when no samples yet. */
  manualPreheatMinutes: 30,
} as const;
