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
  isEventActiveAt,
  selectActiveMatches,
} from "./match.js";

function rule(partial: Partial<CalendarRule> & { matchValue?: string }): CalendarRule {
  const value = partial.matchValue ?? partial.match?.value ?? "Büro";
  return {
    id: partial.id ?? "r1",
    name: partial.name ?? "Büro",
    enabled: partial.enabled ?? true,
    calendarId: partial.calendarId ?? null,
    match: partial.match ?? { kind: "title_contains", value },
    roomIds: partial.roomIds ?? ["room-z1"],
    mode: partial.mode ?? "heat",
    targetTempC: partial.targetTempC ?? 20,
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
    eventMatchesRule(event({ summary: "Home Office" }), rule({})),
    false,
  );
  assert.equal(
    eventMatchesRule(
      event({ summary: "Büro" }),
      rule({ match: { kind: "title_equals", value: "büro" } }),
    ),
    true,
  );
  assert.equal(
    eventMatchesRule(
      event({ summary: "Team: Büro Sync" }),
      rule({ match: { kind: "title_regex", value: "^Team:" } }),
    ),
    true,
  );

  const at = new Date("2026-10-19T12:00:00.000Z");
  assert.equal(isEventActiveAt(event({}), at), true);
  assert.equal(
    isEventActiveAt(
      event({
        startsAt: "2026-10-19T18:00:00.000Z",
        endsAt: "2026-10-19T19:00:00.000Z",
      }),
      at,
    ),
    false,
  );

  const matches = selectActiveMatches(
    [
      event({ uid: "low", summary: "Büro low", calendarId: "a" }),
      event({ uid: "high", summary: "Büro high", calendarId: "a" }),
    ],
    [
      rule({ id: "low", priority: 10, matchValue: "Büro" }),
      rule({
        id: "high",
        priority: 200,
        matchValue: "Büro high",
        roomIds: ["room-z1"],
      }),
    ],
    at,
  );
  assert.equal(matches.get("room-z1")?.rule.id, "high");

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
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].summary, "Büro");
  assert.equal(parsed[0].uid, "abc-1");

  console.log("calendar match helpers ok");
}

main();
