/**
 * Zones REST — room overview for the PWA.
 *
 * @package @heizplan/api
 */

import { Hono } from "hono";
import { listZones } from "../modules/zones/service.js";

export const zonesRoutes = new Hono();

zonesRoutes.get("/", async (c) => {
  const payload = await listZones();
  return c.json(payload);
});
