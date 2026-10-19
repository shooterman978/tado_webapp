/**
 * Zones domain — maps bridge zones to API DTOs.
 * Calendar rules / heat-up learning will attach here later (hooks only).
 *
 * @package @heizplan/api
 */

import type { ZonesResponse } from "@heizplan/shared";
import { getBridgeClient } from "../bridge/service.js";

export async function listZones(): Promise<ZonesResponse> {
  const bridge = getBridgeClient();
  const status = await bridge.getStatus();
  const zones = await bridge.listZones();

  let source: ZonesResponse["source"] = "empty";
  if (zones.length > 0) {
    source = status.paired ? "bridge" : "mock";
  }

  return { zones, source };
}
