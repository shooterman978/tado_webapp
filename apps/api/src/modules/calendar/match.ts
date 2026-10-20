/**
 * Pure calendar rule matching (no I/O).
 *
 * Timing semantics (heat):
 * - during: entire event [start, end)
 * - before: heat so setpoint is reached at start − readyMinutesBefore
 *           (active from readyAt − preheat until event start)
 * - after:  heat so setpoint is reached at end + readyMinutesAfter
 *           (active from readyAt − preheat until readyAt + hold)
 *
 * Off uses the same ready-by anchors but no preheat (instant power off).
 *
 * @package @heizplan/api
 */

import type {
  CalendarPresenceCondition,
  CalendarRule,
  CalendarRuleTiming,
  HomePresenceMode,
} from "@heizplan/shared";
import type { CalDavEvent } from "./caldav.js";
import { defaultPreheatMinutes } from "./heatup.js";

/** Keep heat after “ready” for after-timing (ms). */
const AFTER_HOLD_MS = 2 * 60 * 60_000;

export interface TimingWindowOptions {
  readyMinutesBefore?: number;
  readyMinutesAfter?: number;
  /** Preheat lead for heat mode; ignored for off. */
  preheatMinutes?: number;
  mode?: "heat" | "off";
}

/**
 * Geofencing gate for a rule.
 * Fail-closed: home/away conditions skip when presence is unknown.
 */
export function ruleMatchesPresence(
  condition: CalendarPresenceCondition | undefined,
  presenceMode: HomePresenceMode,
): boolean {
  const gate = condition ?? "always";
  if (gate === "always") {
    return true;
  }
  if (presenceMode === "unknown") {
    return false;
  }
  return gate === presenceMode;
}

export function eventMatchesRule(event: CalDavEvent, rule: CalendarRule): boolean {
  if (!rule.enabled) {
    return false;
  }
  if (rule.calendarId && rule.calendarId !== event.calendarId) {
    return false;
  }
  const title = event.summary ?? "";
  const value = rule.match.value;
  switch (rule.match.kind) {
    case "event_uid": {
      const uids = new Set(
        [
          value,
          ...(Array.isArray(rule.match.eventUids) ? rule.match.eventUids : []),
        ]
          .map(String)
          .filter(Boolean),
      );
      return uids.has(event.uid);
    }
    case "title_equals":
      return title.toLocaleLowerCase() === value.toLocaleLowerCase();
    case "title_regex": {
      try {
        return new RegExp(value, "i").test(title);
      } catch {
        return false;
      }
    }
    case "title_contains":
    default:
      return title.toLocaleLowerCase().includes(value.toLocaleLowerCase());
  }
}

export function isEventActiveAt(event: CalDavEvent, at: Date): boolean {
  const t = at.getTime();
  return Date.parse(event.startsAt) <= t && t < Date.parse(event.endsAt);
}

/**
 * Absolute ready-by / apply window for a timing mode.
 * Returns null if event times are invalid.
 */
export function timingWindowBounds(
  event: CalDavEvent,
  timing: CalendarRuleTiming,
  opts: TimingWindowOptions = {},
): { windowStart: number; windowEnd: number; readyAt: number } | null {
  const start = Date.parse(event.startsAt);
  const end = Date.parse(event.endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }
  const readyBefore = Math.max(0, opts.readyMinutesBefore ?? 60);
  const readyAfter = Math.max(0, opts.readyMinutesAfter ?? 60);
  const mode = opts.mode ?? "heat";
  const preheat =
    mode === "heat"
      ? Math.max(15, opts.preheatMinutes ?? defaultPreheatMinutes())
      : 0;

  switch (timing) {
    case "before": {
      const readyAt = start - readyBefore * 60_000;
      return {
        readyAt,
        windowStart: readyAt - preheat * 60_000,
        windowEnd: start,
      };
    }
    case "after": {
      const readyAt = end + readyAfter * 60_000;
      return {
        readyAt,
        windowStart: readyAt - preheat * 60_000,
        windowEnd: readyAt + AFTER_HOLD_MS,
      };
    }
    case "during":
    default:
      return {
        readyAt: start,
        windowStart: start,
        windowEnd: end,
      };
  }
}

/**
 * Whether `at` falls in the apply window for this timing.
 */
export function isEventInTimingWindow(
  event: CalDavEvent,
  timing: CalendarRuleTiming,
  at = new Date(),
  opts: TimingWindowOptions = {},
): boolean {
  const bounds = timingWindowBounds(event, timing, opts);
  if (!bounds) {
    return false;
  }
  const t = at.getTime();
  return t >= bounds.windowStart && t < bounds.windowEnd;
}

export function filterEventsBySelection(
  events: CalDavEvent[],
  selectedUids: string[],
): CalDavEvent[] {
  if (selectedUids.length === 0) {
    return events;
  }
  const set = new Set(selectedUids);
  return events.filter((e) => set.has(e.uid));
}

export type RoomActionMode = "heat" | "off";

export interface RuleRoomAction {
  rule: CalendarRule;
  event: CalDavEvent;
  mode: RoomActionMode;
  targetTempC: number | null;
  timing: CalendarRuleTiming;
  /** Ready-by instant (ISO) for heat before/after; null for during/off. */
  readyAt: string | null;
  /** Preheat minutes used for this heat action. */
  preheatMinutes: number;
}

/**
 * For each room, pick the highest-priority matching action.
 * Heat and off groups each use their own timing window.
 */
export function selectActiveMatches(
  events: CalDavEvent[],
  rules: CalendarRule[],
  at = new Date(),
  _selectedUids: string[] = [],
  preheatByRoom: Map<string, number> = new Map(),
  presenceMode: HomePresenceMode = "unknown",
): Map<string, RuleRoomAction> {
  const enabled = rules
    .filter((r) => r.enabled)
    .filter((r) => ruleMatchesPresence(r.presenceCondition, presenceMode))
    .sort((a, b) => b.priority - a.priority);
  const byRoom = new Map<string, RuleRoomAction>();

  for (const rule of enabled) {
    const heatTiming = rule.timing ?? "during";
    const offTiming = rule.offTiming ?? rule.timing ?? "during";
    const readyBefore = rule.readyMinutesBefore ?? 60;
    const readyAfter = rule.readyMinutesAfter ?? 60;

    for (const event of events) {
      if (!eventMatchesRule(event, rule)) {
        continue;
      }

      const heatRooms =
        rule.offRoomIds?.length && rule.roomIds
          ? rule.roomIds.filter((id) => !rule.offRoomIds.includes(id))
          : rule.mode === "off"
            ? []
            : rule.roomIds;
      const offRooms =
        rule.offRoomIds?.length > 0
          ? rule.offRoomIds
          : rule.mode === "off"
            ? rule.roomIds
            : [];

      for (const roomId of heatRooms) {
        if (byRoom.has(roomId)) {
          continue;
        }
        const preheat =
          preheatByRoom.get(roomId) ?? defaultPreheatMinutes();
        if (
          !isEventInTimingWindow(event, heatTiming, at, {
            readyMinutesBefore: readyBefore,
            readyMinutesAfter: readyAfter,
            preheatMinutes: preheat,
            mode: "heat",
          })
        ) {
          continue;
        }
        const bounds = timingWindowBounds(event, heatTiming, {
          readyMinutesBefore: readyBefore,
          readyMinutesAfter: readyAfter,
          preheatMinutes: preheat,
          mode: "heat",
        });
        byRoom.set(roomId, {
          rule,
          event,
          mode: "heat",
          targetTempC:
            rule.mode === "eco"
              ? (rule.targetTempC ?? 16)
              : rule.targetTempC,
          timing: heatTiming,
          readyAt:
            heatTiming === "during" || !bounds
              ? null
              : new Date(bounds.readyAt).toISOString(),
          preheatMinutes: preheat,
        });
      }

      for (const roomId of offRooms) {
        if (byRoom.has(roomId)) {
          continue;
        }
        if (
          !isEventInTimingWindow(event, offTiming, at, {
            readyMinutesBefore: readyBefore,
            readyMinutesAfter: readyAfter,
            preheatMinutes: 0,
            mode: "off",
          })
        ) {
          continue;
        }
        byRoom.set(roomId, {
          rule,
          event,
          mode: "off",
          targetTempC: null,
          timing: offTiming,
          readyAt: null,
          preheatMinutes: 0,
        });
      }
    }
  }
  return byRoom;
}
