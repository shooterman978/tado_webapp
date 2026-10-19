/**
 * Unit tests for overlayControl / followsSchedule enrichment.
 * @package @heizplan/api
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  CalendarActiveOverride,
  Zone,
  ZoneSchedule,
} from "@heizplan/shared";
import { enrichZonesWithOverlayControl } from "./overlay-control.js";
import {
  dayTypeForTimetable,
  minutesInBlock,
  resolveScheduleSetpointNow,
  setpointsMatchSchedule,
} from "./schedule-setpoint.js";

function zone(partial: Partial<Zone> & Pick<Zone, "id">): Zone {
  return {
    name: partial.name ?? partial.id,
    currentTempC: 20,
    targetTempC: 21,
    overlayActive: false,
    heatingPowerPercent: 0,
    updatedAt: null,
    ...partial,
  };
}

function schedule(partial?: Partial<ZoneSchedule>): ZoneSchedule {
  return {
    roomId: "room-z9",
    cloudZoneId: 9,
    zoneName: "Büro",
    timetableType: "SEVEN_DAY",
    timetableTypeId: 2,
    homeBlocks: [
      {
        dayType: "MONDAY",
        start: "00:00",
        end: "07:00",
        power: "ON",
        tempC: 18,
      },
      {
        dayType: "MONDAY",
        start: "07:00",
        end: "16:00",
        power: "ON",
        tempC: 21,
      },
      {
        dayType: "MONDAY",
        start: "16:00",
        end: "00:00",
        power: "ON",
        tempC: 18,
      },
    ],
    away: { power: "ON", tempC: 16 },
    fetchedAt: "2026-10-19T21:00:00.000Z",
    ...partial,
  };
}

describe("schedule-setpoint helpers", () => {
  it("treats end 00:00 as end-of-day", () => {
    assert.equal(minutesInBlock(23 * 60 + 59, "16:00", "00:00"), true);
    assert.equal(minutesInBlock(7 * 60, "16:00", "00:00"), false);
    assert.equal(minutesInBlock(7 * 60, "07:00", "16:00"), true);
  });

  it("maps SEVEN_DAY weekday in Europe/Berlin", () => {
    // Monday 2026-10-19 evening CEST
    const mon = new Date("2026-10-19T21:30:00.000Z");
    assert.equal(dayTypeForTimetable(2, mon), "MONDAY");
  });

  it("resolves Büro evening block to 18°C", () => {
    const at = new Date("2026-10-19T21:30:00.000Z"); // 23:30 CEST Monday
    const now = resolveScheduleSetpointNow(schedule(), at);
    assert.equal(now.tempC, 18);
    assert.equal(now.powerOn, true);
  });

  it("matches within 0.25° tolerance only", () => {
    assert.equal(setpointsMatchSchedule(18, 18), true);
    assert.equal(setpointsMatchSchedule(18.2, 18), true);
    assert.equal(setpointsMatchSchedule(18.3, 18), false);
    assert.equal(setpointsMatchSchedule(20, 18), false);
    assert.equal(setpointsMatchSchedule(null, 18), false);
    assert.equal(setpointsMatchSchedule(null, null), true);
  });
});

describe("enrichZonesWithOverlayControl", () => {
  it("marks calendar rooms with rule name and forces overlayActive", () => {
    const active: CalendarActiveOverride[] = [
      {
        ruleId: "r1",
        ruleName: "Büro morgens",
        roomId: "room-a",
        eventUid: "evt-1",
        eventSummary: "Standup",
        startsAt: "2026-10-19T07:00:00.000Z",
        endsAt: "2026-10-19T09:00:00.000Z",
        appliedAt: "2026-10-19T07:00:00.000Z",
        applyPath: "hap_overlay",
        targetTempC: 22,
        mode: "heat",
        needsRestore: false,
      },
    ];
    const [out] = enrichZonesWithOverlayControl(
      [zone({ id: "room-a", overlayActive: false, onSchedule: true })],
      active,
    );
    assert.equal(out.overlayControl, "calendar");
    assert.equal(out.calendarRuleName, "Büro morgens");
    assert.equal(out.overlayActive, true);
    assert.equal(out.followsSchedule, false);
    assert.equal(out.offScheduleReason, "calendar");
  });

  it("marks plain overlay as manual", () => {
    const [out] = enrichZonesWithOverlayControl(
      [zone({ id: "room-b", overlayActive: true, onSchedule: false })],
      [],
      { schedules: { "room-b": schedule({ roomId: "room-b" }) } },
    );
    assert.equal(out.overlayControl, "manual");
    assert.equal(out.offScheduleReason, "manual_overlay");
    assert.equal(out.followsSchedule, false);
  });

  it("does NOT claim followsSchedule without schedule cache", () => {
    const [out] = enrichZonesWithOverlayControl(
      [zone({ id: "room-c", overlayActive: false, targetTempC: 20 })],
      [],
    );
    assert.equal(out.overlayControl, "none");
    assert.equal(out.followsSchedule, null);
    assert.equal(out.onSchedule, false);
  });

  it("false-positive guard: HAP 20° vs schedule 18° → mismatch, not on schedule", () => {
    const at = new Date("2026-10-19T21:30:00.000Z"); // Mon 23:30 CEST → 18°C
    const [out] = enrichZonesWithOverlayControl(
      [
        zone({
          id: "room-z9",
          name: "Büro",
          overlayActive: false,
          onSchedule: true,
          targetTempC: 20,
        }),
      ],
      [],
      { schedules: { "room-z9": schedule() }, now: at },
    );
    assert.equal(out.followsSchedule, false);
    assert.equal(out.onSchedule, false);
    assert.equal(out.overlayControl, "manual");
    assert.equal(out.overlayActive, true);
    assert.equal(out.offScheduleReason, "setpoint_mismatch");
    assert.equal(out.scheduleTargetTempC, 18);
  });

  it("matches schedule within tolerance → followsSchedule", () => {
    const at = new Date("2026-10-19T21:30:00.000Z");
    const [out] = enrichZonesWithOverlayControl(
      [
        zone({
          id: "room-z9",
          overlayActive: false,
          targetTempC: 18.2,
        }),
      ],
      [],
      { schedules: { "room-z9": schedule() }, now: at },
    );
    assert.equal(out.followsSchedule, true);
    assert.equal(out.overlayControl, "none");
    assert.equal(out.overlayActive, false);
    assert.equal(out.offScheduleReason, null);
  });

  it("still flags mismatch after overlay flag cleared (sync/resume regression)", () => {
    const at = new Date("2026-10-19T21:30:00.000Z");
    const [out] = enrichZonesWithOverlayControl(
      [
        zone({
          id: "room-z9",
          overlayActive: false,
          overlayControl: "none",
          onSchedule: true,
          targetTempC: 20,
        }),
      ],
      [],
      { schedules: { "room-z9": schedule() }, now: at },
    );
    assert.notEqual(out.overlayControl, "none");
    assert.equal(out.followsSchedule, false);
    assert.equal(out.offScheduleReason, "setpoint_mismatch");
  });
});
