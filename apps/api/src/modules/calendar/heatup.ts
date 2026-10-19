/**
 * Preheat lead-time for calendar “before” / “after” heat targets.
 *
 * Heat-up learning ({@link HeatupLearningHook}) is not wired yet — we use a
 * conservative default so heating starts early enough for the ready-by time.
 *
 * TODO(heatup-learning): replace {@link estimatePreheatMinutes} with samples
 * from learning once the DB/HAP path lands.
 *
 * @package @heizplan/api
 */

/** Conservative default when learning has no estimate (minutes). */
export const DEFAULT_PREHEAT_MINUTES = 60;

/**
 * Estimated minutes of heating needed to reach the setpoint.
 * Always returns at least 15 minutes.
 */
export async function estimatePreheatMinutes(
  _roomId: string,
): Promise<number> {
  // No HeatupLearningHook implementation in this branch yet.
  return DEFAULT_PREHEAT_MINUTES;
}

/** Sync helper for pure match tests (same default as async path). */
export function defaultPreheatMinutes(): number {
  return DEFAULT_PREHEAT_MINUTES;
}
