/**
 * HTTP smoke for heatup routes (uses process env already set / defaults).
 * Seeds into BRIDGE_DATA_DIR — uses a temp dir via env only if still default.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { createApp } from "../app.js";
import { resetHeatupCaches } from "../modules/heatup/service.js";
import { resetOutdoorCache } from "../modules/heatup/outdoor.js";

describe("heatup routes smoke", () => {
  let dir: string | null = null;

  after(async () => {
    resetHeatupCaches();
    resetOutdoorCache();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("GET /api/heatup/status returns Lünen coords and provider", async () => {
    const app = createApp();
    const res = await app.request("/api/heatup/status");
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      provider: string;
      lat: number;
      lon: number;
      fallback: string | null;
    };
    assert.ok(["brightsky", "openmeteo", "stub"].includes(body.provider));
    assert.equal(body.lat, 51.6167);
    assert.equal(body.lon, 7.5281);
  });

  it("POST fixtures/seed + GET prediction", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "heatup-http-"));
    // Note: config.bridgeDataDir is already bound — seed writes to configured dir.
    // This still validates route wiring and response shape.
    resetHeatupCaches();
    const app = createApp();
    const seed = await app.request("/api/heatup/fixtures/seed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId: "zone-bath" }),
    });
    assert.equal(seed.status, 200);
    const seeded = (await seed.json()) as { ok: boolean; sampleCount: number };
    assert.equal(seeded.ok, true);
    assert.ok(seeded.sampleCount >= 8);

    const pred = await app.request(
      "/api/heatup/rooms/zone-bath/prediction?targetTempC=22&currentTempC=18&readyAt=2026-03-01T07:00:00.000Z",
    );
    assert.equal(pred.status, 200);
    const body = (await pred.json()) as {
      recommendedStartAt: string | null;
      estimatedMinutes: number | null;
      method: string;
    };
    assert.ok(body.estimatedMinutes != null);
    assert.ok(body.recommendedStartAt);
  });
});
