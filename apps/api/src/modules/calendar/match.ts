/**
 * Pure calendar rule matching (no I/O).
 *
 * @package @heizplan/api
 */

import type { CalendarRule, CalendarRuleTiming } from "@heizplan/shared";
import type { CalDavEvent } from "./caldav.js";

/** Grace after start / around end for at_start / at_end (ms). */
const START_WINDOW_MS = 30 * 60_000;
const END_WINDOW_MS = 45 * 60_000;

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
 * Whether the event is in the timing window for this rule.
 * - during: entire event
 * - at_start: from start for ~30 min (or until end if shorter)
 * - at_end: from end−ε through ~45 min after end
 */
export function isEventInTimingWindow(
  event: CalDavEvent,
  timing: CalendarRuleTiming,
  at = new Date(),
): boolean {
  const t = at.getTime();
  const start = Date.parse(event.startsAt);
  const end = Date.parse(event.endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return false;
  }
  switch (timing) {
    case "at_start":
      return t >= start && t < Math.min(end, start + START_WINDOW_MS);
    case "at_end":
      return t >= end - 60_000 && t < end + END_WINDOW_MS;
    case "during":
    default:
      return start <= t && t < end;
  }
}

/**
 * When Jonas marked events in the picker, optionally narrow the candidate set.
 * Empty selection → all fetched events (pattern + UID rules).
 */
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
  /** Per-group timing (heat vs off). */
  timing: CalendarRuleTiming;
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
): Map<string, RuleRoomAction> {
  const enabled = rules
    .filter((r) => r.enabled)
    .sort((a, b) => b.priority - a.priority);
  const byRoom = new Map<string, RuleRoomAction>();

  for (const rule of enabled) {
    const heatTiming = rule.timing ?? "during";
    const offTiming = rule.offTiming ?? rule.timing ?? "during";

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

      if (isEventInTimingWindow(event, heatTiming, at)) {
        for (const roomId of heatRooms) {
          if (byRoom.has(roomId)) {
            continue;
          }
          byRoom.set(roomId, {
            rule,
            event,
            mode: "heat",
            targetTempC:
              rule.mode === "eco"
                ? (rule.targetTempC ?? 16)
                : rule.targetTempC,
            timing: heatTiming,
          });
        }
      }

      if (isEventInTimingWindow(event, offTiming, at)) {
        for (const roomId of offRooms) {
          if (byRoom.has(roomId)) {
            continue;
          }
          byRoom.set(roomId, {
            rule,
            event,
            mode: "off",
            targetTempC: null,
            timing: offTiming,
          });
        }
      }
    }
  }
  return byRoom;
}
