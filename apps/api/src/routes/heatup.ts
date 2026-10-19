/**
 * Heat-up learning REST — status, samples, prediction, observe, fixtures.
 *
 * @package @heizplan/api
 */

import { Hono } from "hono";
import {
  getHeatupStatus,
  getPrediction,
  getRoomSummary,
  listRoomSamples,
  observeRoom,
  seedFixtures,
} from "../modules/heatup/service.js";

export const heatupRoutes = new Hono();

heatupRoutes.get("/status", async (c) => {
  const status = await getHeatupStatus();
  return c.json(status);
});

heatupRoutes.post("/fixtures/seed", async (c) => {
  let roomId = "zone-bath";
  try {
    const body = (await c.req.json()) as { roomId?: string };
    if (typeof body?.roomId === "string" && body.roomId.length > 0) {
      roomId = body.roomId;
    }
  } catch {
    // empty body ok
  }
  const result = await seedFixtures(roomId);
  return c.json({ ok: true, ...result });
});

heatupRoutes.get("/rooms/:roomId", async (c) => {
  const roomId = c.req.param("roomId");
  const currentTempC = optionalNumber(c.req.query("currentTempC"));
  const targetTempC = optionalNumber(c.req.query("targetTempC"));
  const summary = await getRoomSummary(roomId, {
    currentTempC: currentTempC ?? null,
    targetTempC: targetTempC ?? undefined,
  });
  return c.json(summary);
});

heatupRoutes.get("/rooms/:roomId/prediction", async (c) => {
  const roomId = c.req.param("roomId");
  const targetTempC = optionalNumber(c.req.query("targetTempC"));
  if (targetTempC == null) {
    return c.json(
      { error: "invalid_query", message: "targetTempC is required" },
      400,
    );
  }
  const currentTempC = optionalNumber(c.req.query("currentTempC"));
  const readyAt = c.req.query("readyAt") ?? c.req.query("at") ?? undefined;
  const prediction = await getPrediction({
    roomId,
    targetTempC,
    currentTempC: currentTempC ?? null,
    readyAt,
  });
  return c.json(prediction);
});

heatupRoutes.get("/rooms/:roomId/samples", async (c) => {
  const roomId = c.req.param("roomId");
  const samples = await listRoomSamples(roomId);
  return c.json({ roomId, samples });
});

/**
 * Feed a zone snapshot for capture (Arrival-bounded: start → first reach).
 * Body: `{ currentTempC, targetTempC, heatingPowerPercent?, windowOpen? }`
 */
heatupRoutes.post("/rooms/:roomId/observe", async (c) => {
  const roomId = c.req.param("roomId");
  try {
    const body = await c.req.json<{
      currentTempC?: number | null;
      targetTempC?: number | null;
      heatingPowerPercent?: number | null;
      windowOpen?: boolean;
      overlayActive?: boolean;
      openWindowAutoOffActive?: boolean;
    }>();
    const result = await observeRoom(roomId, {
      currentTempC: body?.currentTempC ?? null,
      targetTempC: body?.targetTempC ?? null,
      heatingPowerPercent: body?.heatingPowerPercent ?? null,
      windowOpen: body?.windowOpen === true,
      overlayActive: body?.overlayActive === true,
      openWindowAutoOffActive: body?.openWindowAutoOffActive === true,
    });
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Observe failed";
    return c.json({ error: "observe_failed", message }, 400);
  }
});

function optionalNumber(raw: string | undefined): number | null {
  if (raw === undefined || raw === "") {
    return null;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
