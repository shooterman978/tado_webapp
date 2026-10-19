/**
 * Zones REST — room overview and setpoint for the PWA.
 *
 * @package @heizplan/api
 */

import { Hono } from "hono";
import { listZones, setZoneTemperature } from "../modules/zones/service.js";

export const zonesRoutes = new Hono();

zonesRoutes.get("/", async (c) => {
  const payload = await listZones();
  return c.json(payload);
});

/**
 * Set target temperature for a zone (HomeKit thermostat).
 * Body: `{ "tempC": number }`
 */
zonesRoutes.post("/:zoneId/temperature", async (c) => {
  const zoneId = c.req.param("zoneId");
  let tempC: number;
  try {
    const body = await c.req.json<{ tempC?: number }>();
    tempC = Number(body?.tempC);
  } catch {
    return c.json({ error: "invalid_body", message: "Expected JSON { tempC }" }, 400);
  }
  if (!Number.isFinite(tempC)) {
    return c.json({ error: "invalid_temp", message: "tempC must be a number" }, 400);
  }

  try {
    await setZoneTemperature(zoneId, tempC);
    return c.json({ ok: true, zoneId, tempC });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Set temperature failed";
    console.error("[zones] set temperature failed:", message);
    const status = message.includes("not paired") ? 409 : 502;
    return c.json({ error: "set_temperature_failed", message }, status);
  }
});
