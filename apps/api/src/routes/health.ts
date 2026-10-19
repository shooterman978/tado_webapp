/**
 * Health endpoint for Compose / Proxmox probes.
 *
 * @package @heizplan/api
 */

import { Hono } from "hono";
import type { HealthStatus } from "@heizplan/shared";
import { config } from "../config.js";
import { getBridgeClient } from "../modules/bridge/service.js";

export const healthRoutes = new Hono();

healthRoutes.get("/", async (c) => {
  const bridge = getBridgeClient();
  const status = await bridge.getStatus();

  const body: HealthStatus = {
    status: "ok",
    service: "heizplan-api",
    version: config.version,
    bridge: {
      state: status.state,
      paired: status.paired,
      message: status.message,
    },
    timestamp: new Date().toISOString(),
  };

  return c.json(body);
});
