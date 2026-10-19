/**
 * Zones domain — maps bridge zones to API DTOs.
 * Calendar rules / heat-up learning will attach here later (hooks only).
 *
 * @package @heizplan/api
 */

import type { Zone, ZonesResponse } from "@heizplan/shared";
import { config } from "../../config.js";
import { getBridgeClient } from "../bridge/service.js";

const MOCK_ZONES: Zone[] = [
  {
    id: "zone-living",
    name: "Wohnzimmer",
    currentTempC: 19.4,
    targetTempC: 21.0,
    overlayActive: false,
    heatingPowerPercent: 42,
    updatedAt: new Date().toISOString(),
  },
  {
    id: "zone-office",
    name: "Büro",
    currentTempC: 18.1,
    targetTempC: null,
    overlayActive: false,
    heatingPowerPercent: 0,
    updatedAt: new Date().toISOString(),
  },
  {
    id: "zone-bath",
    name: "Bad",
    currentTempC: 20.2,
    targetTempC: 22.0,
    overlayActive: true,
    heatingPowerPercent: 65,
    updatedAt: new Date().toISOString(),
  },
];

export async function listZones(): Promise<ZonesResponse> {
  const bridge = getBridgeClient();
  const status = await bridge.getStatus();

  if (status.paired) {
    const zones = await bridge.listZones();
    return { zones, source: zones.length > 0 ? "bridge" : "empty" };
  }

  if (config.useMockZones) {
    return {
      zones: MOCK_ZONES.map((z) => ({
        ...z,
        updatedAt: new Date().toISOString(),
      })),
      source: "mock",
    };
  }

  return { zones: [], source: "empty" };
}

export async function setZoneTemperature(
  zoneId: string,
  tempC: number,
): Promise<void> {
  const bridge = getBridgeClient();
  const status = await bridge.getStatus();
  if (!status.paired) {
    throw new Error("Bridge is not paired — cannot set temperature.");
  }
  await bridge.setTargetTemperature(zoneId, tempC);
}
