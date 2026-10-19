/**
 * Unit tests for calendar vs manual overlayControl enrichment.
 * @package @heizplan/api
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CalendarActiveOverride, Zone } from "@heizplan/shared";
import { enrichZonesWithOverlayControl } from "./overlay-control.js";

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
    assert.equal(out.onSchedule, false);
  });

  it("marks plain overlay as manual", () => {
    const [out] = enrichZonesWithOverlayControl(
      [zone({ id: "room-b", overlayActive: true, onSchedule: false })],
      [],
    );
    assert.equal(out.overlayControl, "manual");
    assert.equal(out.calendarRuleName, null);
  });

  it("marks idle rooms as none / on schedule", () => {
    const [out] = enrichZonesWithOverlayControl(
      [zone({ id: "room-c", overlayActive: false })],
      [],
    );
    assert.equal(out.overlayControl, "none");
    assert.equal(out.onSchedule, true);
  });
});
