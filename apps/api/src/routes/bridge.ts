/**
 * Bridge pairing endpoints.
 * PIN is accepted from env (preferred) or request body — never logged or echoed.
 *
 * @package @heizplan/api
 */

import { Hono } from "hono";
import { config } from "../config.js";
import { getBridgeClient, getHapBridgeClient } from "../modules/bridge/service.js";

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
 * Pair with the Tado V3 Bridge.
 * Body: `{ "pin"?: "XXX-XX-XXX" }` — omit to use TADO_BRIDGE_PIN from env.
 * Never returns or logs the PIN.
 */
bridgeRoutes.post("/pair", async (c) => {
  let bodyPin: string | undefined;
  try {
    const body = await c.req.json<{ pin?: string }>();
    bodyPin = typeof body?.pin === "string" ? body.pin : undefined;
  } catch {
    bodyPin = undefined;
  }

  const pin = bodyPin || config.bridgePin;
  if (!pin) {
    return c.json(
      {
        error: "pin_required",
        message:
          "Set TADO_BRIDGE_PIN in .env (XXX-XX-XXX) or pass { pin } in the body once over LAN.",
      },
      400,
    );
  }
  if (!config.bridgeIp && !bodyPin) {
    // still allow pairWithPin if IP is configured; IP is required by client
  }
  if (!config.bridgeIp) {
    return c.json(
      {
        error: "bridge_ip_required",
        message: "Set TADO_BRIDGE_IP in .env to the LAN address of the V3 Bridge.",
      },
      400,
    );
  }

  try {
    await getHapBridgeClient().pairWithPin(pin);
    const status = await getBridgeClient().getStatus();
    return c.json({ ok: true, bridge: status });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Pairing failed";
    // Do not include PIN or raw protocol dumps.
    console.error("[bridge] pairing failed:", message);
    return c.json({ error: "pairing_failed", message }, 502);
  }
});
