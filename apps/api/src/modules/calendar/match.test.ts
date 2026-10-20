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
  ruleMatchesPresence,
  selectActiveMatches,
  timingWindowBounds,
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
    readyMinutesBefore: partial.readyMinutesBefore ?? 60,
    readyMinutesAfter: partial.readyMinutesAfter ?? 60,
    applyPath: partial.applyPath ?? "hap_overlay",
    presenceCondition: partial.presenceCondition ?? "always",
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

  const mid = new Date("2026-10-19T12:00:00.000Z");
  const ev = event({}); // 08:00–17:00Z
  assert.equal(isEventInTimingWindow(ev, "during", mid), true);

  // before: ready at 07:00, preheat 60 → window 06:00–08:00
  const beforeOpts = {
    readyMinutesBefore: 60,
    preheatMinutes: 60,
    mode: "heat" as const,
  };
  const boundsBefore = timingWindowBounds(ev, "before", beforeOpts)!;
  assert.equal(
    new Date(boundsBefore.readyAt).toISOString(),
    "2026-10-19T07:00:00.000Z",
  );
  assert.equal(
    isEventInTimingWindow(
      ev,
      "before",
      new Date("2026-10-19T06:30:00.000Z"),
      beforeOpts,
    ),
    true,
  );
  assert.equal(
    isEventInTimingWindow(ev, "before", mid, beforeOpts),
    false,
  );

  // after: end 17:00 + 60 → ready 18:00, preheat 60 → window 17:00–20:00
  const afterOpts = {
    readyMinutesAfter: 60,
    preheatMinutes: 60,
    mode: "heat" as const,
  };
  const boundsAfter = timingWindowBounds(ev, "after", afterOpts)!;
  assert.equal(
    new Date(boundsAfter.readyAt).toISOString(),
    "2026-10-19T18:00:00.000Z",
  );
  assert.equal(
    isEventInTimingWindow(
      ev,
      "after",
      new Date("2026-10-19T17:30:00.000Z"),
      afterOpts,
    ),
    true,
  );
  assert.equal(isEventInTimingWindow(ev, "after", mid, afterOpts), false);

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

  // Per-group: heat before (active morning), off during (midday)
  const morning = new Date("2026-10-19T06:30:00.000Z");
  const splitMorning = selectActiveMatches(
    [event({})],
    [
      rule({
        id: "split",
        roomIds: ["heat-2"],
        offRoomIds: ["off-2"],
        timing: "before",
        offTiming: "during",
        readyMinutesBefore: 60,
        targetTempC: 21,
      }),
    ],
    morning,
    [],
    new Map([["heat-2", 60]]),
  );
  assert.equal(splitMorning.has("heat-2"), true);
  assert.equal(splitMorning.has("off-2"), false);

  const splitMid = selectActiveMatches(
    [event({})],
    [
      rule({
        id: "split",
        roomIds: ["heat-2"],
        offRoomIds: ["off-2"],
        timing: "before",
        offTiming: "during",
        readyMinutesBefore: 60,
        targetTempC: 21,
      }),
    ],
    mid,
    [],
    new Map([["heat-2", 60]]),
  );
  assert.equal(splitMid.has("heat-2"), false);
  assert.equal(splitMid.has("off-2"), true);

  // Geofencing: rule gated on home/away
  assert.equal(ruleMatchesPresence("always", "unknown"), true);
  assert.equal(ruleMatchesPresence("home", "unknown"), false);
  assert.equal(ruleMatchesPresence("home", "home"), true);
  assert.equal(ruleMatchesPresence("away", "home"), false);
  assert.equal(ruleMatchesPresence("away", "away"), true);

  const homeOnly = selectActiveMatches(
    [event({})],
    [rule({ presenceCondition: "home", roomIds: ["r-home"] })],
    mid,
    [],
    new Map(),
    "away",
  );
  assert.equal(homeOnly.size, 0);

  const homeOk = selectActiveMatches(
    [event({})],
    [rule({ presenceCondition: "home", roomIds: ["r-home"] })],
    mid,
    [],
    new Map(),
    "home",
  );
  assert.equal(homeOk.has("r-home"), true);

  assert.equal(
    filterEventsBySelection([event({ uid: "a" }), event({ uid: "b" })], ["b"])
      .length,
    1,
  );

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
