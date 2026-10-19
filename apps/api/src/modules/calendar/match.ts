/**
 * Pure calendar rule matching (no I/O).
 *
 * @package @heizplan/api
 */

import type { CalendarRule } from "@heizplan/shared";
import type { CalDavEvent } from "./caldav.js";

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

export interface RuleMatch {
  rule: CalendarRule;
  event: CalDavEvent;
}

/**
 * For each room, pick the highest-priority matching active event/rule.
 * Priority: CalendarOverride layer is applied by callers above overlays.
 */
export function selectActiveMatches(
  events: CalDavEvent[],
  rules: CalendarRule[],
  at = new Date(),
): Map<string, RuleMatch> {
  const enabled = rules.filter((r) => r.enabled).sort((a, b) => b.priority - a.priority);
  const activeEvents = events.filter((e) => isEventActiveAt(e, at));
  const byRoom = new Map<string, RuleMatch>();

  for (const rule of enabled) {
    for (const event of activeEvents) {
      if (!eventMatchesRule(event, rule)) {
        continue;
      }
      for (const roomId of rule.roomIds) {
        if (byRoom.has(roomId)) {
          continue; // higher priority already won
        }
        byRoom.set(roomId, { rule, event });
      }
    }
  }
  return byRoom;
}
