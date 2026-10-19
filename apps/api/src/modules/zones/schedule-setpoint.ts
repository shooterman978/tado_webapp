/**
 * Resolve the Smart Schedule setpoint for “now” from a cached ZoneSchedule.
 * Used to detect HAP drift vs. timeline (HAP has no real overlay/schedule flag).
 *
 * @package @heizplan/api
 */

import type {
  ScheduleBlock,
  ScheduleDayType,
  ZoneSchedule,
} from "@heizplan/shared";

const TZ = "Europe/Berlin";

/** Max |HAP − schedule| (°C) still treated as “follows schedule”. */
export const SCHEDULE_SETPOINT_TOLERANCE_C = 0.25;

const WEEKDAY_SEVEN: ScheduleDayType[] = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
];

export interface ScheduleSetpointNow {
  /** Target °C when power ON; null when power OFF or unknown. */
  tempC: number | null;
  /** True when a Home block covers “now”. */
  powerOn: boolean;
  dayType: ScheduleDayType;
  block: ScheduleBlock | null;
}

function berlinParts(at: Date): { weekday: number; minutes: number } {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(at).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const map: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  const weekday = map[parts.weekday ?? ""] ?? at.getUTCDay();
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  return {
    weekday: Number.isFinite(weekday) ? weekday : 0,
    minutes: hour * 60 + minute,
  };
}

/** Map Europe/Berlin “now” onto the timetable’s dayType key. */
export function dayTypeForTimetable(
  timetableTypeId: 0 | 1 | 2,
  at: Date = new Date(),
): ScheduleDayType {
  const { weekday } = berlinParts(at);
  if (timetableTypeId === 0) {
    return "MONDAY_TO_SUNDAY";
  }
  if (timetableTypeId === 1) {
    if (weekday >= 0 && weekday <= 4) {
      return "MONDAY_TO_FRIDAY";
    }
    return weekday === 5 ? "SATURDAY" : "SUNDAY";
  }
  return WEEKDAY_SEVEN[weekday] ?? "MONDAY";
}

function parseHm(hm: string): number {
  const [h, m] = hm.split(":").map((x) => Number(x));
  if (!Number.isFinite(h) || !Number.isFinite(m)) {
    return 0;
  }
  return h * 60 + m;
}

/** True when `minutes` is in [start, end) with end 00:00 → 24:00. */
export function minutesInBlock(
  minutes: number,
  startHm: string,
  endHm: string,
): boolean {
  const start = parseHm(startHm);
  let end = parseHm(endHm);
  if (end === 0 && endHm === "00:00") {
    end = 24 * 60;
  }
  if (end > start) {
    return minutes >= start && minutes < end;
  }
  // Overnight wrap (rare in Tado Home blocks).
  return minutes >= start || minutes < end;
}

/**
 * Current Home-timetable setpoint from cache (no cloud HTTP).
 * Returns null when the schedule has no block for now.
 */
export function resolveScheduleSetpointNow(
  schedule: ZoneSchedule,
  at: Date = new Date(),
): ScheduleSetpointNow {
  const dayType = dayTypeForTimetable(schedule.timetableTypeId, at);
  const { minutes } = berlinParts(at);
  const blocks = schedule.homeBlocks.filter((b) => b.dayType === dayType);
  const block =
    blocks.find((b) => minutesInBlock(minutes, b.start, b.end)) ?? null;
  if (!block) {
    return { tempC: null, powerOn: false, dayType, block: null };
  }
  const powerOn = block.power === "ON";
  return {
    tempC: powerOn && block.tempC != null ? block.tempC : null,
    powerOn,
    dayType,
    block,
  };
}

/**
 * Compare HAP target to schedule target.
 * Both null (OFF) → match. One null → mismatch. Else |Δ| ≤ tolerance.
 */
export function setpointsMatchSchedule(
  hapTargetTempC: number | null,
  scheduleTempC: number | null,
  toleranceC: number = SCHEDULE_SETPOINT_TOLERANCE_C,
): boolean {
  if (hapTargetTempC == null && scheduleTempC == null) {
    return true;
  }
  if (hapTargetTempC == null || scheduleTempC == null) {
    return false;
  }
  return Math.abs(hapTargetTempC - scheduleTempC) <= toleranceC;
}
