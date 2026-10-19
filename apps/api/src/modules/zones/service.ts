/**
 * Zones domain — maps bridge devices to room tiles (aggregated + named).
 * Calendar rules / heat-up learning will attach here later (hooks only).
 *
 * @package @heizplan/api
 */

import type { Zone, ZonesResponse } from "@heizplan/shared";
import { config } from "../../config.js";
import { getBridgeClient } from "../bridge/service.js";
import { getCachedZoneMetadata, getCloudStatus } from "../cloud/service.js";
import { loadRoomMap } from "../cloud/store.js";
import {
  aggregateRooms,
  resolveDeviceIds,
} from "../rooms/aggregate.js";

const MOCK_ZONES: Zone[] = [
  {
    id: "zone-living",
    name: "Wohn- & Esszimmer",
    currentTempC: 19.4,
    targetTempC: 21.0,
    overlayActive: false,
    heatingPowerPercent: 42,
    updatedAt: new Date().toISOString(),
    deviceCount: 2,
    nameSource: "mock",
  },
  {
    id: "zone-office",
    name: "Büro",
    currentTempC: 18.1,
    targetTempC: null,
    overlayActive: false,
    heatingPowerPercent: 0,
    updatedAt: new Date().toISOString(),
    deviceCount: 1,
    nameSource: "mock",
  },
  {
    id: "zone-kids",
    name: "Kinderzimmer",
    currentTempC: 19.0,
    targetTempC: 20.0,
    overlayActive: true,
    heatingPowerPercent: 30,
    updatedAt: new Date().toISOString(),
    deviceCount: 1,
    nameSource: "mock",
  },
  {
    id: "zone-bath",
    name: "Badezimmer",
    currentTempC: 20.2,
    targetTempC: 22.0,
    overlayActive: true,
    heatingPowerPercent: 65,
    updatedAt: new Date().toISOString(),
    deviceCount: 1,
    nameSource: "mock",
  },
  {
    id: "zone-kitchen",
    name: "Küche",
    currentTempC: 19.8,
    targetTempC: 20.0,
    overlayActive: false,
    heatingPowerPercent: 0,
    updatedAt: new Date().toISOString(),
    deviceCount: 1,
    nameSource: "mock",
  },
  {
    id: "zone-bed",
    name: "Schlafzimmer",
    currentTempC: 18.5,
    targetTempC: 18.0,
    overlayActive: true,
    heatingPowerPercent: 10,
    updatedAt: new Date().toISOString(),
    deviceCount: 1,
    nameSource: "mock",
  },
];

export async function listZones(): Promise<ZonesResponse> {
  const bridge = getBridgeClient();
  const status = await bridge.getStatus();

  if (status.paired) {
    const devices = await bridge.listZones();
    const [meta, roomMap, cloud] = await Promise.all([
      getCachedZoneMetadata(),
      loadRoomMap(config.bridgeDataDir),
      getCloudStatus(),
    ]);
    const { zones, naming } = aggregateRooms(devices, meta, roomMap);
    return {
      zones,
      source: zones.length > 0 ? "bridge" : "empty",
      naming: {
        ...naming,
        cloudLinked: cloud.linked,
        syncedAt: naming.syncedAt ?? cloud.syncedAt,
      },
    };
  }

  if (config.useMockZones) {
    return {
      zones: MOCK_ZONES.map((z) => ({
        ...z,
        updatedAt: new Date().toISOString(),
      })),
      source: "mock",
      naming: {
        source: "mock",
        syncedAt: null,
        cloudLinked: false,
        unresolvedDeviceCount: 0,
      },
    };
  }

  return {
    zones: [],
    source: "empty",
    naming: {
      source: "none",
      syncedAt: null,
      cloudLinked: false,
      unresolvedDeviceCount: 0,
    },
  };
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

  // Resolve room tile → HAP aids (aggregated rooms set all devices).
  const listed = await listZones();
  const deviceIds = resolveDeviceIds(zoneId, listed.zones);
  if (deviceIds.length === 0) {
    throw new Error(`Unknown zone: ${zoneId}`);
  }

  const errors: string[] = [];
  for (const deviceId of deviceIds) {
    try {
      await bridge.setTargetTemperature(deviceId, tempC);
    } catch (err) {
      errors.push(
        err instanceof Error ? err.message : `device ${deviceId} failed`,
      );
    }
  }
  if (errors.length === deviceIds.length) {
    throw new Error(errors[0] ?? "Set temperature failed");
  }
  if (errors.length > 0) {
    console.warn(
      `[zones] partial setpoint for ${zoneId}: ${errors.join("; ")}`,
    );
  }
}
