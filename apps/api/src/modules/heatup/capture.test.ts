/**
 * Arrival-bounded capture + quality rejects (Comfort-Start patterns).
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { Zone } from "@heizplan/shared";
import { observeZoneHeatup } from "./capture.js";
import { listSamplesForRoom, resetHeatupStoreCaches } from "./sample-store.js";

function zone(partial: Partial<Zone>): Zone {
  return {
    id: "zone-bath",
    name: "Bad",
    currentTempC: 18,
    targetTempC: 22,
    overlayActive: true,
    heatingPowerPercent: 50,
    windowOpen: false,
    updatedAt: new Date().toISOString(),
    ...partial,
  };
}

describe("observeZoneHeatup", () => {
  let dir: string;

  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "heatup-"));
    process.env.OUTDOOR_PROVIDER = "stub";
    resetHeatupStoreCaches();
  });

  after(async () => {
    resetHeatupStoreCaches();
    await rm(dir, { recursive: true, force: true });
  });

  it("starts, progresses, completes at first reach (Arrival-Stop)", async () => {
    resetHeatupStoreCaches();
    const t0 = "2026-01-10T06:00:00.000Z";
    const start = await observeZoneHeatup(dir, zone({ currentTempC: 18, targetTempC: 22 }), t0);
    assert.equal(start.action, "started");

    const mid = await observeZoneHeatup(
      dir,
      zone({ currentTempC: 20, targetTempC: 22, heatingPowerPercent: 60 }),
      "2026-01-10T06:15:00.000Z",
    );
    assert.equal(mid.action, "progress");

    const done = await observeZoneHeatup(
      dir,
      zone({ currentTempC: 21.8, targetTempC: 22, heatingPowerPercent: 40 }),
      "2026-01-10T06:35:00.000Z",
    );
    assert.equal(done.action, "completed");
    const samples = await listSamplesForRoom(dir, "zone-bath");
    assert.equal(samples.filter((s) => s.quality === "ok").length, 1);
  });

  it("rejects when window opens (observation-only)", async () => {
    resetHeatupStoreCaches();
    await observeZoneHeatup(
      dir,
      zone({ id: "zone-win", currentTempC: 18, targetTempC: 22 }),
      "2026-01-11T06:00:00.000Z",
    );
    const rej = await observeZoneHeatup(
      dir,
      zone({
        id: "zone-win",
        currentTempC: 18.5,
        targetTempC: 22,
        windowOpen: true,
      }),
      "2026-01-11T06:10:00.000Z",
    );
    assert.equal(rej.action, "rejected");
    assert.equal(rej.reason, "window_open");
  });
});
