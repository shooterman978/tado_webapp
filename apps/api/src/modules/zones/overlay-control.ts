/**
 * Derive overlayControl / followsSchedule for zone payloads.
 * Priority: CalendarOverride > local overlay tracker > HAP vs schedule setpoint.
 *
 * @package @heizplan/api
 */

import type {
  CalendarActiveOverride,
  Zone,
  ZoneSchedule,
} from "@heizplan/shared";
import {
  resolveScheduleSetpointNow,
  setpointsMatchSchedule,
} from "./schedule-setpoint.js";

export interface OverlayControlOptions {
  /** Cached Smart Schedules by room id (disk only). */
  schedules?: Record<string, ZoneSchedule | undefined>;
  /** Clock override for tests. */
  now?: Date;
}

/**
 * Attach overlayControl / followsSchedule / calendar fields.
 * Never treat a missing local overlay flag alone as “on schedule”.
 */
export function enrichZonesWithOverlayControl(
  zones: Zone[],
  active: CalendarActiveOverride[],
  opts: OverlayControlOptions = {},
): Zone[] {
  const byRoom = new Map(active.map((o) => [o.roomId, o]));
  const schedules = opts.schedules ?? {};
  const now = opts.now ?? new Date();

  return zones.map((zone) => {
    const cal = byRoom.get(zone.id);
    if (cal) {
      return {
        ...zone,
        overlayActive: true,
        onSchedule: false,
        followsSchedule: false,
        scheduleTargetTempC: cal.targetTempC ?? zone.scheduleTargetTempC ?? null,
        offScheduleReason: "calendar" as const,
        overlayControl: "calendar" as const,
        calendarRuleName: cal.ruleName,
        calendarRuleId: cal.ruleId,
        overlayEndsAt: zone.overlayEndsAt ?? cal.endsAt ?? null,
      };
    }

    if (zone.overlayActive) {
      const schedule = schedules[zone.id];
      const resolved = schedule
        ? resolveScheduleSetpointNow(schedule, now)
        : null;
      return {
        ...zone,
        onSchedule: false,
        followsSchedule: false,
        scheduleTargetTempC: resolved ? resolved.tempC : null,
        offScheduleReason: "manual_overlay" as const,
        overlayControl: "manual" as const,
        calendarRuleName: null,
        calendarRuleId: null,
      };
    }

    const schedule = schedules[zone.id];
    if (!schedule) {
      // No cache → must not claim “Folgt dem Zeitplan”.
      return {
        ...zone,
        onSchedule: false,
        followsSchedule: null,
        scheduleTargetTempC: null,
        offScheduleReason: null,
        overlayControl: "none" as const,
        calendarRuleName: null,
        calendarRuleId: null,
      };
    }

    const resolved = resolveScheduleSetpointNow(schedule, now);
    const match = setpointsMatchSchedule(zone.targetTempC, resolved.tempC);
    if (match) {
      return {
        ...zone,
        overlayActive: false,
        onSchedule: true,
        followsSchedule: true,
        scheduleTargetTempC: resolved.tempC,
        offScheduleReason: null,
        overlayControl: "none" as const,
        calendarRuleName: null,
        calendarRuleId: null,
      };
    }

    return {
      ...zone,
      overlayActive: true,
      onSchedule: false,
      followsSchedule: false,
      scheduleTargetTempC: resolved.tempC,
      offScheduleReason: "setpoint_mismatch" as const,
      overlayControl: "manual" as const,
      calendarRuleName: null,
      calendarRuleId: null,
    };
  });
}
