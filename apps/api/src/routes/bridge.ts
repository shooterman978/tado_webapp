/**
 * Bridge pairing preparation endpoints (no secrets in responses).
 *
 * @package @heizplan/api
 */

import { Hono } from "hono";
import { getBridgeClient } from "../modules/bridge/service.js";

export const bridgeRoutes = new Hono();

bridgeRoutes.get("/status", async (c) => {
  const status = await getBridgeClient().getStatus();
  return c.json(status);
});

bridgeRoutes.post("/prepare-pairing", async (c) => {
  const result = await getBridgeClient().preparePairing();
  return c.json(result);
});

/**
 * Pairing with PIN is intentionally not exposed as a casual public route yet.
 * When HAP lands: require auth + sesskey-equivalent + rate limit; accept PIN
 * only over HTTPS / LAN; never log the PIN.
 */
bridgeRoutes.post("/pair", async (c) => {
  return c.json(
    {
      error: "not_implemented",
      message:
        "HAP pairWithPin follows iteratively. Use prepare-pairing + free HomeKit slot first.",
    },
    501,
  );
});
