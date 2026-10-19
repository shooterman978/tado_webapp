/**
 * Zones domain — room tiles, setpoints, power, overlay helpers.
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
import {
  applyOverlayHints,
  clearOverlayRecord,
  setOverlay,
} from "./overlay-store.js";

/** Rich fixtures for UI parity without a live bridge. */
const MOCK_ZONES: Zone[] = [
  {
    id: "zone-living",
    name: "Wohn- & Esszimmer",
    currentTempC: 19.4,
    targetTempC: 21.0,
    overlayActive: false,
    onSchedule: true,
    heatingPowerPercent: 42,
    humidityPercent: 48,
    updatedAt: new Date().toISOString(),
    deviceCount: 2,
    nameSource: "mock",
    devices: [
      {
        id: "mock-1",
        name: "Radiator · VA1234",
        serialNo: "VA1234567890",
        batteryLow: false,
        currentTempC: 19.2,
        targetTempC: 21.0,
      },
      {
        id: "mock-2",
        name: "Radiator · VA5678",
        serialNo: "VA5678123456",
        batteryLow: false,
        currentTempC: 19.6,
        targetTempC: 21.0,
      },
    ],
    deviceIds: ["mock-1", "mock-2"],
  },
  {
    id: "zone-office",
    name: "Büro",
    currentTempC: 18.1,
    targetTempC: 18.0,
    overlayActive: false,
    onSchedule: true,
    heatingPowerPercent: 0,
    humidityPercent: 42,
    updatedAt: new Date().toISOString(),
    deviceCount: 1,
    nameSource: "mock",
    devices: [
      {
        id: "mock-3",
        name: "Thermostat · BU0099",
        serialNo: "BU0099123456",
        batteryLow: true,
        currentTempC: 18.1,
        targetTempC: 18.0,
      },
    ],
    deviceIds: ["mock-3"],
  },
  {
    id: "zone-kids",
    name: "Kinderzimmer",
    currentTempC: 19.0,
    targetTempC: 20.0,
    overlayActive: true,
    onSchedule: false,
    overlayEndsAt: new Date(Date.now() + 45 * 60_000).toISOString(),
    heatingPowerPercent: 30,
    humidityPercent: 51,
    updatedAt: new Date().toISOString(),
    deviceCount: 1,
    nameSource: "mock",
    devices: [
      {
        id: "mock-4",
        name: "Radiator · KI0042",
        serialNo: "KI0042123456",
        batteryLow: false,
        currentTempC: 19.0,
        targetTempC: 20.0,
      },
    ],
    deviceIds: ["mock-4"],
  },
  {
    id: "zone-bath",
    name: "Badezimmer",
    currentTempC: 20.2,
    targetTempC: 22.0,
    overlayActive: true,
    onSchedule: false,
    overlayEndsAt: null,
    heatingPowerPercent: 65,
    humidityPercent: 62,
    updatedAt: new Date().toISOString(),
    deviceCount: 1,
    nameSource: "mock",
    devices: [
      {
        id: "mock-5",
        name: "Radiator · BA0011",
        serialNo: "BA0011123456",
        batteryLow: false,
        currentTempC: 20.2,
        targetTempC: 22.0,
      },
    ],
    deviceIds: ["mock-5"],
  },
  {
    id: "zone-kitchen",
    name: "Küche",
    currentTempC: 20.0,
    targetTempC: 18.0,
    overlayActive: false,
    onSchedule: true,
    heatingPowerPercent: 0,
    humidityPercent: 55,
    updatedAt: new Date().toISOString(),
    deviceCount: 1,
    nameSource: "mock",
    devices: [
      {
        id: "mock-6",
        name: "Radiator · KU0077",
        serialNo: "KU0077123456",
        batteryLow: false,
        currentTempC: 20.0,
        targetTempC: 18.0,
      },
    ],
    deviceIds: ["mock-6"],
  },
  {
    id: "zone-bed",
    name: "Schlafzimmer",
    currentTempC: 18.5,
    targetTempC: 18.0,
    overlayActive: false,
    onSchedule: true,
    heatingPowerPercent: 10,
    humidityPercent: 46,
    updatedAt: new Date().toISOString(),
    deviceCount: 1,
    nameSource: "mock",
    devices: [
      {
        id: "mock-7",
        name: "Radiator · SL0033",
        serialNo: "SL0033123456",
        batteryLow: false,
        currentTempC: 17.8,
        targetTempC: 17.5,
      },
    ],
    deviceIds: ["mock-7"],
  },
];

const PRESENCE_UNKNOWN: ZonesResponse["presence"] = {
  mode: "unknown",
  source: "none",
  message:
    "Home/Away lokal simulierbar in der PWA; Auto/Geofence ist Cloud/Abo.",
};

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
      zones: zones.map((z) => applyOverlayHints(z)),
      source: zones.length > 0 ? "bridge" : "empty",
      naming: {
        ...naming,
        cloudLinked: cloud.linked,
        syncedAt: naming.syncedAt ?? cloud.syncedAt,
      },
      presence: PRESENCE_UNKNOWN,
    };
  }

  if (config.useMockZones) {
    return {
      zones: MOCK_ZONES.map((z) =>
        applyOverlayHints({
          ...z,
          updatedAt: new Date().toISOString(),
        }),
      ),
      source: "mock",
      naming: {
        source: "mock",
        syncedAt: null,
        cloudLinked: false,
        unresolvedDeviceCount: 0,
      },
      presence: {
        mode: "home",
        source: "manual",
        message: "Fixture: Home (lokal simuliert).",
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
    presence: PRESENCE_UNKNOWN,
  };
}

async function requirePairedBridge() {
  const bridge = getBridgeClient();
  const status = await bridge.getStatus();
  if (!status.paired) {
    throw new Error("Bridge is not paired — cannot control zones.");
  }
  return bridge;
}

async function deviceIdsFor(zoneId: string): Promise<string[]> {
  const listed = await listZones();
  const deviceIds = resolveDeviceIds(zoneId, listed.zones);
  if (deviceIds.length === 0) {
    throw new Error(`Unknown zone: ${zoneId}`);
  }
  return deviceIds;
}

export async function setZoneTemperature(
  zoneId: string,
  tempC: number,
  opts?: { durationMinutes?: number | null },
): Promise<void> {
  const bridge = await requirePairedBridge();
  const deviceIds = await deviceIdsFor(zoneId);

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

  setOverlay(zoneId, {
    tempC,
    durationMinutes: opts?.durationMinutes ?? null,
  });
}

export async function clearZoneOverlay(zoneId: string): Promise<void> {
  const bridge = await requirePairedBridge();
  const deviceIds = await deviceIdsFor(zoneId);
  clearOverlayRecord(zoneId);

  for (const deviceId of deviceIds) {
    try {
      await bridge.clearOverlay(deviceId);
    } catch (err) {
      console.warn(
        `[zones] clearOverlay ${deviceId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

export async function setZonePower(
  zoneId: string,
  mode: "heat" | "off",
): Promise<void> {
  const bridge = await requirePairedBridge();
  const deviceIds = await deviceIdsFor(zoneId);

  if (mode === "off") {
    clearOverlayRecord(zoneId);
  }

  const errors: string[] = [];
  for (const deviceId of deviceIds) {
    try {
      if (bridge.setPowerMode) {
        await bridge.setPowerMode(deviceId, mode);
      } else if (mode === "off") {
        await bridge.clearOverlay(deviceId);
      } else {
        const listed = await listZones();
        const zone = listed.zones.find((z) => z.id === zoneId);
        const temp = zone?.targetTempC ?? 20;
        await bridge.setTargetTemperature(deviceId, temp);
      }
    } catch (err) {
      errors.push(
        err instanceof Error ? err.message : `device ${deviceId} failed`,
      );
    }
  }
  if (errors.length === deviceIds.length) {
    throw new Error(errors[0] ?? "Set power failed");
  }
}

export async function quickActionAllOff(): Promise<void> {
  const listed = await listZones();
  for (const zone of listed.zones) {
    await setZonePower(zone.id, "off");
  }
}

export async function quickActionBoost(durationMinutes = 30): Promise<void> {
  const listed = await listZones();
  for (const zone of listed.zones) {
    await setZoneTemperature(zone.id, 25, { durationMinutes });
  }
}

export async function quickActionResumeSchedule(): Promise<void> {
  const listed = await listZones();
  for (const zone of listed.zones) {
    if (zone.overlayActive) {
      await clearZoneOverlay(zone.id);
    }
  }
}
