/**
 * Zones REST — room overview, setpoint, power, overlay, quick actions.
 *
 * @package @heizplan/api
 */

import { Hono } from "hono";
import {
  clearZoneOverlay,
  listZones,
  quickActionAllOff,
  quickActionBoost,
  quickActionResumeSchedule,
  setZonePower,
  setZoneTemperature,
} from "../modules/zones/service.js";

export const zonesRoutes = new Hono();

zonesRoutes.get("/", async (c) => {
  const payload = await listZones();
  return c.json(payload);
});

/** Quick actions affecting all rooms — registered before :zoneId. */
zonesRoutes.post("/quick-actions/:action", async (c) => {
  const action = c.req.param("action");
  try {
    if (action === "off") {
      await quickActionAllOff();
    } else if (action === "boost") {
      await quickActionBoost(30);
    } else if (action === "resume") {
      await quickActionResumeSchedule();
    } else {
      return c.json(
        { error: "unknown_action", message: "Use off, boost, or resume" },
        400,
      );
    }
    return c.json({ ok: true, action });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Quick action failed";
    const status = message.includes("not paired") ? 409 : 502;
    return c.json({ error: "quick_action_failed", message }, status);
  }
});

/**
 * Set target temperature for a zone (HomeKit thermostat).
 * Body: `{ "tempC": number, "durationMinutes"?: number | null }`
 */
zonesRoutes.post("/:zoneId/temperature", async (c) => {
  const zoneId = c.req.param("zoneId");
  let tempC: number;
  let durationMinutes: number | null | undefined;
  try {
    const body = await c.req.json<{
      tempC?: number;
      durationMinutes?: number | null;
    }>();
    tempC = Number(body?.tempC);
    durationMinutes = body?.durationMinutes;
  } catch {
    return c.json({ error: "invalid_body", message: "Expected JSON { tempC }" }, 400);
  }
  if (!Number.isFinite(tempC)) {
    return c.json({ error: "invalid_temp", message: "tempC must be a number" }, 400);
  }

  try {
    await setZoneTemperature(zoneId, tempC, { durationMinutes });
    return c.json({ ok: true, zoneId, tempC, durationMinutes: durationMinutes ?? null });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Set temperature failed";
    console.error("[zones] set temperature failed:", message);
    const status = message.includes("not paired") ? 409 : 502;
    return c.json({ error: "set_temperature_failed", message }, status);
  }
});

/** Clear manual overlay / resume schedule approximation. */
zonesRoutes.post("/:zoneId/overlay/clear", async (c) => {
  const zoneId = c.req.param("zoneId");
  try {
    await clearZoneOverlay(zoneId);
    return c.json({ ok: true, zoneId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Clear overlay failed";
    const status = message.includes("not paired") ? 409 : 502;
    return c.json({ error: "clear_overlay_failed", message }, status);
  }
});

/** Body: `{ "mode": "heat" | "off" }` */
zonesRoutes.post("/:zoneId/power", async (c) => {
  const zoneId = c.req.param("zoneId");
  let mode: "heat" | "off";
  try {
    const body = await c.req.json<{ mode?: string }>();
    if (body?.mode !== "heat" && body?.mode !== "off") {
      return c.json(
        { error: "invalid_mode", message: 'mode must be "heat" or "off"' },
        400,
      );
    }
    mode = body.mode;
  } catch {
    return c.json({ error: "invalid_body", message: 'Expected JSON { mode }' }, 400);
  }

  try {
    await setZonePower(zoneId, mode);
    return c.json({ ok: true, zoneId, mode });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Set power failed";
    const status = message.includes("not paired") ? 409 : 502;
    return c.json({ error: "set_power_failed", message }, status);
  }
});
