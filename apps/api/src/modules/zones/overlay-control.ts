/**
 * Distinguish manual vs calendar overlay for zone payloads.
 * @package @heizplan/api
 */

import type { CalendarActiveOverride, Zone } from "@heizplan/shared";

/**
 * Attach overlayControl / calendarRuleName from active CalendarOverrides.
 * Calendar wins over a plain manual overlay record for the same room.
 */
export function enrichZonesWithOverlayControl(
  zones: Zone[],
  active: CalendarActiveOverride[],
): Zone[] {
  const byRoom = new Map(active.map((o) => [o.roomId, o]));
  return zones.map((zone) => {
    const cal = byRoom.get(zone.id);
    if (cal) {
      return {
        ...zone,
        overlayActive: true,
        onSchedule: false,
        overlayControl: "calendar" as const,
        calendarRuleName: cal.ruleName,
        calendarRuleId: cal.ruleId,
        overlayEndsAt: zone.overlayEndsAt ?? cal.endsAt ?? null,
      };
    }
    if (zone.overlayActive) {
      return {
        ...zone,
        onSchedule: false,
        overlayControl: "manual" as const,
        calendarRuleName: null,
        calendarRuleId: null,
      };
    }
    return {
      ...zone,
      onSchedule: zone.onSchedule ?? true,
      overlayControl: "none" as const,
      calendarRuleName: null,
      calendarRuleId: null,
    };
  });
}
