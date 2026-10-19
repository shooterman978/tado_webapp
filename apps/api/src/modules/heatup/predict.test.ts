/**
 * Unit tests — Model 0 EMA + Model 3 OLS (math-playground formulas, own TS).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { HeatupSample } from "@heizplan/shared";
import {
  fitModel3,
  predictHeatup,
  predictModel0Minutes,
  rebuildRoomModel,
  updateEmaRate,
  weatherFactor,
} from "./predict.js";

function okSample(partial: Partial<HeatupSample> & { durationMinutes: number; deltaTC: number }): HeatupSample {
  const start = 18;
  const target = start + partial.deltaTC;
  return {
    id: partial.id ?? `s-${partial.durationMinutes}`,
    roomId: partial.roomId ?? "zone-bath",
    startedAt: partial.startedAt ?? "2026-01-01T05:00:00.000Z",
    endedAt: partial.endedAt ?? "2026-01-01T05:40:00.000Z",
    startTempC: partial.startTempC ?? start,
    targetTempC: partial.targetTempC ?? target,
    deltaTC: partial.deltaTC,
    outdoorTempC: partial.outdoorTempC ?? 4,
    durationMinutes: partial.durationMinutes,
    quality: "ok",
    rejectReason: null,
  };
}

describe("Model 0 EMA", () => {
  it("computes r_new = ΔT / duration and smooths with α", () => {
    const s1 = okSample({ deltaTC: 4, durationMinutes: 40 }); // 0.1 °C/min
    const r1 = updateEmaRate(null, s1, 0.3);
    assert.equal(r1, 0.1);

    const s2 = okSample({ deltaTC: 4, durationMinutes: 20 }); // 0.2 °C/min
    const r2 = updateEmaRate(r1, s2, 0.3);
    // 0.3*0.2 + 0.7*0.1 = 0.13
    assert.ok(r2 != null);
    assert.ok(Math.abs(r2! - 0.13) < 1e-9);

    const minutes = predictModel0Minutes(4, r2!, 3);
    assert.ok(Math.abs(minutes - (4 / 0.13 + 3)) < 1e-6);
  });

  it("ignores rejected samples", () => {
    const rejected: HeatupSample = {
      ...okSample({ deltaTC: 4, durationMinutes: 10 }),
      quality: "rejected",
      rejectReason: "window_open",
    };
    assert.equal(updateEmaRate(0.1, rejected, 0.3), 0.1);
  });
});

describe("Model 3 OLS", () => {
  it("fits β and predicts with WF = (Tsp − Toat)/60", () => {
    const samples = [
      okSample({ deltaTC: 4, durationMinutes: 40, outdoorTempC: 0, targetTempC: 22, startTempC: 18 }),
      okSample({ deltaTC: 3, durationMinutes: 28, outdoorTempC: 5, targetTempC: 21, startTempC: 18 }),
      okSample({ deltaTC: 4, durationMinutes: 32, outdoorTempC: 8, targetTempC: 22, startTempC: 18 }),
      okSample({ deltaTC: 2, durationMinutes: 18, outdoorTempC: 10, targetTempC: 20, startTempC: 18 }),
      okSample({ deltaTC: 5, durationMinutes: 50, outdoorTempC: -2, targetTempC: 22, startTempC: 17 }),
      okSample({ deltaTC: 3.5, durationMinutes: 30, outdoorTempC: 4, targetTempC: 22, startTempC: 18.5 }),
      okSample({ deltaTC: 4.5, durationMinutes: 44, outdoorTempC: 1, targetTempC: 22, startTempC: 17.5 }),
    ];
    const coeffs = fitModel3(samples);
    assert.ok(coeffs);

    const wf = weatherFactor(22, 4);
    assert.ok(Math.abs(wf - (22 - 4) / 60) < 1e-9);

    const state = rebuildRoomModel("zone-bath", samples, 0.3, 3);
    assert.ok(state.rateEmaCPerMin != null);
    assert.equal(state.okSampleCount, 7);
    assert.ok(state.model3);

    const prediction = predictHeatup({
      roomId: "zone-bath",
      samples,
      state,
      currentTempC: 18,
      targetTempC: 22,
      outdoorTempC: 4,
      outdoorProvider: "stub",
      readyAt: "2026-03-01T07:00:00.000Z",
      manualPreheatMinutes: 30,
      emaAlpha: 0.3,
      minSamplesForUi: 3,
      minSamplesForModel3: 7,
    });
    assert.equal(prediction.method, "model3");
    assert.ok(prediction.estimatedMinutes != null);
    assert.ok(prediction.recommendedStartAt);
    assert.equal(prediction.confidence, "high");
  });
});

describe("predictHeatup fallbacks", () => {
  it("uses Model 0 when Model 3 not eligible", () => {
    const samples = [
      okSample({ deltaTC: 4, durationMinutes: 40, outdoorTempC: 4 }),
      okSample({ deltaTC: 3, durationMinutes: 30, outdoorTempC: 5 }),
      okSample({ deltaTC: 4, durationMinutes: 36, outdoorTempC: 4 }),
    ];
    const state = rebuildRoomModel("zone-bath", samples, 0.3, 3);
    const prediction = predictHeatup({
      roomId: "zone-bath",
      samples,
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
    assert.equal(prediction.method, "model0");
    assert.ok(prediction.estimatedMinutes != null);
  });

  it("falls back to manual without samples", () => {
    const state = rebuildRoomModel("zone-empty", [], 0.3, 3);
    const prediction = predictHeatup({
      roomId: "zone-empty",
      samples: [],
      state,
      currentTempC: 18,
      targetTempC: 22,
      outdoorTempC: null,
      outdoorProvider: null,
      readyAt: "2026-03-01T07:00:00.000Z",
      manualPreheatMinutes: 30,
      emaAlpha: 0.3,
      minSamplesForUi: 3,
      minSamplesForModel3: 7,
    });
    assert.equal(prediction.method, "manual");
    assert.equal(prediction.estimatedMinutes, 30);
  });
});
