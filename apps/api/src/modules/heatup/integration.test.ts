/**
 * End-to-end heat-up: fixtures → prediction → capture filters.
 * Env must be set before config modules load — use a child worker pattern:
 * this file only runs capture + predict against an isolated data dir (no config mutate).
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { Zone } from "@heizplan/shared";
import { observeZoneHeatup } from "./capture.js";
import { buildFixtureSamples } from "./fixtures.js";
import {
  predictHeatup,
  rebuildRoomModel,
} from "./predict.js";
import {
  listSamplesForRoom,
  replaceSamples,
  resetHeatupStoreCaches,
} from "./sample-store.js";
import { resetModelStoreCache } from "./model-store.js";
import { resetOutdoorCache } from "./outdoor.js";

function zone(partial: Partial<Zone> & { id: string }): Zone {
  return {
    name: partial.name ?? partial.id,
    currentTempC: 18,
    targetTempC: 22,
    overlayActive: true,
    heatingPowerPercent: 50,
    windowOpen: false,
    updatedAt: new Date().toISOString(),
    ...partial,
  };
}

describe("heatup learning e2e (isolated dir)", () => {
  let dir: string;

  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "heatup-e2e-"));
    resetHeatupStoreCaches();
    resetModelStoreCache();
    resetOutdoorCache();
  });

  after(async () => {
    resetHeatupStoreCaches();
    resetModelStoreCache();
    resetOutdoorCache();
    await rm(dir, { recursive: true, force: true });
  });

  it("fixtures → Model 0/3 prediction with recommendedStartAt", async () => {
    const fixtures = buildFixtureSamples("zone-bath");
    await replaceSamples(dir, fixtures);
    const state = rebuildRoomModel("zone-bath", fixtures, 0.3, 3);
    assert.ok(state.okSampleCount >= 7);
    assert.ok(state.rateEmaCPerMin != null);

    const prediction = predictHeatup({
      roomId: "zone-bath",
      samples: fixtures,
      state,
      currentTempC: 18,
      targetTempC: 22,
      outdoorTempC: 4,
      outdoorProvider: "brightsky",
      readyAt: "2026-03-01T07:00:00.000Z",
      manualPreheatMinutes: 30,
      emaAlpha: 0.3,
      minSamplesForUi: 3,
      minSamplesForModel3: 7,
    });
    assert.ok(prediction.method === "model0" || prediction.method === "model3");
    assert.ok(prediction.estimatedMinutes != null && prediction.estimatedMinutes > 0);
    assert.ok(prediction.recommendedStartAt);
    assert.match(prediction.message, /Start empfohlen|Vorlauf/);
  });

  it("live capture: start → progress → complete; window → reject", async () => {
    resetHeatupStoreCaches();
    const t0 = "2026-03-02T06:00:00.000Z";

    const start = await observeZoneHeatup(
      dir,
      zone({ id: "zone-live", currentTempC: 18, targetTempC: 22 }),
      t0,
    );
    assert.equal(start.action, "started");

    const mid = await observeZoneHeatup(
      dir,
      zone({
        id: "zone-live",
        currentTempC: 20,
        targetTempC: 22,
        heatingPowerPercent: 60,
      }),
      "2026-03-02T06:12:00.000Z",
    );
    assert.equal(mid.action, "progress");

    const done = await observeZoneHeatup(
      dir,
      zone({
        id: "zone-live",
        currentTempC: 21.8,
        targetTempC: 22,
        heatingPowerPercent: 30,
      }),
      "2026-03-02T06:28:00.000Z",
    );
    assert.equal(done.action, "completed");
    const ok = (await listSamplesForRoom(dir, "zone-live")).filter(
      (s) => s.quality === "ok",
    );
    assert.equal(ok.length, 1);
    assert.ok((ok[0].durationMinutes ?? 0) >= 2);

    await observeZoneHeatup(
      dir,
      zone({ id: "zone-win", currentTempC: 18, targetTempC: 22 }),
      "2026-03-02T07:00:00.000Z",
    );
    const rej = await observeZoneHeatup(
      dir,
      zone({
        id: "zone-win",
        currentTempC: 18.4,
        targetTempC: 22,
        windowOpen: true,
      }),
      "2026-03-02T07:08:00.000Z",
    );
    assert.equal(rej.action, "rejected");
    assert.equal(rej.reason, "window_open");

    const abortStart = await observeZoneHeatup(
      dir,
      zone({ id: "zone-abort", currentTempC: 18, targetTempC: 22 }),
      "2026-03-02T08:00:00.000Z",
    );
    assert.equal(abortStart.action, "started");
    const abort = await observeZoneHeatup(
      dir,
      zone({
        id: "zone-abort",
        currentTempC: 18.2,
        targetTempC: 22,
        heatingPowerPercent: 0,
      }),
      "2026-03-02T08:05:00.000Z",
    );
    assert.equal(abort.action, "rejected");
    assert.equal(abort.reason, "manual_abort");
  });
});
