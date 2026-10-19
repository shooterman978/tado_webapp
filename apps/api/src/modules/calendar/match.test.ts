/**
 * Smoke tests for calendar rule matching (no network).
 * Run: pnpm --filter @heizplan/api exec tsx src/modules/calendar/match.test.ts
 *
 * @package @heizplan/api
 */

import assert from "node:assert/strict";
import type { CalendarRule } from "@heizplan/shared";
import type { CalDavEvent } from "./caldav.js";
import { parseIcalDate, parseVEvents } from "./caldav.js";
import {
  eventMatchesRule,
  filterEventsBySelection,
  isEventActiveAt,
  isEventInTimingWindow,
  selectActiveMatches,
} from "./match.js";

function rule(
  partial: Partial<CalendarRule> & { matchValue?: string },
): CalendarRule {
  const value = partial.matchValue ?? partial.match?.value ?? "Büro";
  return {
    id: partial.id ?? "r1",
    name: partial.name ?? "Büro",
    enabled: partial.enabled ?? true,
    calendarId: partial.calendarId ?? null,
    match: partial.match ?? { kind: "title_contains", value },
    roomIds: partial.roomIds ?? ["room-z1"],
    offRoomIds: partial.offRoomIds ?? [],
    mode: partial.mode ?? "heat",
    targetTempC: partial.targetTempC ?? 20,
    timing: partial.timing ?? "during",
    offTiming: partial.offTiming ?? partial.timing ?? "during",
    applyPath: partial.applyPath ?? "hap_overlay",
    priority: partial.priority ?? 100,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function event(partial: Partial<CalDavEvent>): CalDavEvent {
  return {
    uid: partial.uid ?? "e1",
    summary: partial.summary ?? "Büro",
    startsAt: partial.startsAt ?? "2026-10-19T08:00:00.000Z",
    endsAt: partial.endsAt ?? "2026-10-19T17:00:00.000Z",
    calendarId: partial.calendarId ?? "/cal/home/",
    calendarHref: partial.calendarHref ?? "https://caldav.icloud.com/cal/home/",
    href: partial.href ?? "https://caldav.icloud.com/cal/home/e1.ics",
  };
}

function main(): void {
  assert.equal(
    eventMatchesRule(event({ summary: "Arbeit im Büro" }), rule({})),
    true,
  );
  assert.equal(
    eventMatchesRule(
      event({ uid: "u2" }),
      rule({
        match: { kind: "event_uid", value: "u1", eventUids: ["u1", "u2"] },
      }),
    ),
    true,
  );

  const mid = new Date("2026-10-19T12:00:00.000Z");
  const nearStart = new Date("2026-10-19T08:10:00.000Z");
  const afterEnd = new Date("2026-10-19T17:10:00.000Z");
  const ev = event({});
  assert.equal(isEventInTimingWindow(ev, "during", mid), true);
  assert.equal(isEventInTimingWindow(ev, "at_start", nearStart), true);
  assert.equal(isEventInTimingWindow(ev, "at_start", mid), false);
  assert.equal(isEventInTimingWindow(ev, "at_end", afterEnd), true);
  assert.equal(isEventInTimingWindow(ev, "at_end", mid), false);

  assert.equal(isEventActiveAt(ev, mid), true);

  const matches = selectActiveMatches(
    [event({ uid: "e1", summary: "Büro" })],
    [
      rule({
        id: "mix",
        roomIds: ["heat-1"],
        offRoomIds: ["off-1"],
        targetTempC: 21,
        timing: "during",
      }),
    ],
    mid,
  );
  assert.equal(matches.get("heat-1")?.mode, "heat");
  assert.equal(matches.get("off-1")?.mode, "off");

  // Per-group timing: heat during, off only at end.
  const split = selectActiveMatches(
    [event({})],
    [
      rule({
        id: "split",
        roomIds: ["heat-2"],
        offRoomIds: ["off-2"],
        timing: "during",
        offTiming: "at_end",
        targetTempC: 21,
      }),
    ],
    mid,
  );
  assert.equal(split.has("heat-2"), true);
  assert.equal(split.has("off-2"), false);
  const splitEnd = selectActiveMatches(
    [event({})],
    [
      rule({
        id: "split",
        roomIds: ["heat-2"],
        offRoomIds: ["off-2"],
        timing: "during",
        offTiming: "at_end",
        targetTempC: 21,
      }),
    ],
    afterEnd,
  );
  assert.equal(splitEnd.has("heat-2"), false);
  assert.equal(splitEnd.has("off-2"), true);

  // Pattern rules still match without selection filter.
  const future = selectActiveMatches(
    [event({ uid: "future", summary: "Büro später", startsAt: "2026-10-19T08:00:00.000Z", endsAt: "2026-10-19T17:00:00.000Z" })],
    [rule({ matchValue: "Büro" })],
    mid,
    [],
  );
  assert.ok(future.has("room-z1"));

  assert.equal(filterEventsBySelection([event({ uid: "a" }), event({ uid: "b" })], ["b"]).length, 1);

  const iso = parseIcalDate("20261019T083000Z");
  assert.equal(iso, "2026-10-19T08:30:00.000Z");

  const parsed = parseVEvents(
    [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:abc-1",
      "SUMMARY:Büro",
      "DTSTART:20261019T080000Z",
      "DTEND:20261019T170000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n"),
    {
      id: "/cal/",
      href: "https://caldav.icloud.com/cal/",
      displayName: "Home",
    },
    "https://caldav.icloud.com/cal/abc.ics",
  );
  assert.equal(parsed[0].uid, "abc-1");

  console.log("calendar match helpers ok");
}

main();
