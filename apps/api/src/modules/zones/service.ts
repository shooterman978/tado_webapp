/**
 * Zones domain — room tiles, setpoints, power, overlay helpers.
 *
 * @package @heizplan/api
 */

import type { OpenWindowSettings, Zone, ZonesResponse } from "@heizplan/shared";
import { config } from "../../config.js";
import { getBridgeClient, getHapBridgeClient } from "../bridge/service.js";
import { getCachedZoneMetadata, getCloudStatus } from "../cloud/service.js";
import { loadRoomMap } from "../cloud/store.js";
import {
  aggregateRooms,
  resolveDeviceIds,
} from "../rooms/aggregate.js";
import {
  enrichZonesWithWindowState,
  getOpenWindowSettings,
  processOpenWindowAutoOff,
  saveOpenWindowSettings,
  setWindowOverride,
} from "./open-window.js";
import {
  applyOverlayHints,
  clearOverlayRecord,
  setOverlay,
} from "./overlay-store.js";

/** Mutable fixture state for unpaired UI / open-window smoke. */
const MOCK_ZONE_STATE = new Map<string, Partial<Zone>>();

/** Rich fixtures for UI parity without a live bridge. */
function buildMockZones(): Zone[] {
  const base: Zone[] = [
    {
      id: "zone-living",
      name: "Wohn- & Esszimmer",
      currentTempC: 19.4,
      targetTempC: 21.0,
      overlayActive: false,
      onSchedule: true,
      heatingPowerPercent: 42,
      humidityPercent: 48,
      windowOpen: false,
      windowSource: "fixture",
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
      /** Fixture: open window for UI smoke without live HAP event. */
      windowOpen: true,
      windowSource: "fixture",
      windowDetectedAt: new Date().toISOString(),
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
          windowOpen: true,
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
      windowOpen: false,
      windowSource: "fixture",
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
      windowOpen: false,
      windowSource: "fixture",
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
      windowOpen: false,
      windowSource: "fixture",
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
      windowOpen: false,
      windowSource: "fixture",
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

  return base.map((z) => {
    const patch = MOCK_ZONE_STATE.get(z.id);
    return {
      ...z,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
  });
}

const PRESENCE_UNKNOWN: ZonesResponse["presence"] = {
  mode: "unknown",
  source: "none",
  message:
    "Home/Away lokal simulierbar in der PWA; Auto/Geofence ist Cloud/Abo.",
};

async function finishZones(
  zones: Zone[],
  source: ZonesResponse["source"],
  naming: ZonesResponse["naming"],
  presence: ZonesResponse["presence"],
): Promise<ZonesResponse> {
  const withOverlay = zones.map((z) => applyOverlayHints(z));
  const withWindow = await enrichZonesWithWindowState(withOverlay);
  const afterAuto = await processOpenWindowAutoOff(withWindow, {
    setZonePower,
    setZoneTemperature,
    clearZoneOverlay,
  });
  return { zones: afterAuto, source, naming, presence };
}

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
    return finishZones(
      zones,
      zones.length > 0 ? "bridge" : "empty",
      {
        ...naming,
        cloudLinked: cloud.linked,
        syncedAt: naming.syncedAt ?? cloud.syncedAt,
      },
      PRESENCE_UNKNOWN,
    );
  }

  if (config.useMockZones) {
    return finishZones(
      buildMockZones(),
      "mock",
      {
        source: "mock",
        syncedAt: null,
        cloudLinked: false,
        unresolvedDeviceCount: 0,
      },
      {
        mode: "home",
        source: "manual",
        message: "Fixture: Home (lokal simuliert).",
      },
    );
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
  const listed = await listZonesRaw();
  const deviceIds = resolveDeviceIds(zoneId, listed);
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
  const bridge = getBridgeClient();
  const status = await bridge.getStatus();

  if (!status.paired && config.useMockZones) {
    MOCK_ZONE_STATE.set(zoneId, {
      ...(MOCK_ZONE_STATE.get(zoneId) ?? {}),
      targetTempC: tempC,
      overlayActive: true,
      onSchedule: false,
      heatingPowerPercent: 40,
    });
    setOverlay(zoneId, {
      tempC,
      durationMinutes: opts?.durationMinutes ?? null,
    });
    return;
  }

  const paired = await requirePairedBridge();
  const deviceIds = await deviceIdsFor(zoneId);

  const errors: string[] = [];
  for (const deviceId of deviceIds) {
    try {
      await paired.setTargetTemperature(deviceId, tempC);
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
  const bridge = getBridgeClient();
  const status = await bridge.getStatus();
  clearOverlayRecord(zoneId);

  if (!status.paired && config.useMockZones) {
    const prev = MOCK_ZONE_STATE.get(zoneId) ?? {};
    MOCK_ZONE_STATE.set(zoneId, {
      ...prev,
      overlayActive: false,
      onSchedule: true,
      targetTempC: prev.targetTempC ?? 20,
    });
    return;
  }

  const paired = await requirePairedBridge();
  const deviceIds = await deviceIdsFor(zoneId);

  for (const deviceId of deviceIds) {
    try {
      await paired.clearOverlay(deviceId);
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
  const bridge = getBridgeClient();
  const status = await bridge.getStatus();

  if (mode === "off") {
    clearOverlayRecord(zoneId);
  }

  if (!status.paired && config.useMockZones) {
    MOCK_ZONE_STATE.set(zoneId, {
      ...(MOCK_ZONE_STATE.get(zoneId) ?? {}),
      targetTempC: mode === "off" ? null : (MOCK_ZONE_STATE.get(zoneId)?.targetTempC ?? 20),
      overlayActive: false,
      onSchedule: mode === "heat",
      heatingPowerPercent: mode === "off" ? 0 : 30,
    });
    return;
  }

  const paired = await requirePairedBridge();
  const deviceIds = await deviceIdsFor(zoneId);

  const errors: string[] = [];
  for (const deviceId of deviceIds) {
    try {
      if (paired.setPowerMode) {
        await paired.setPowerMode(deviceId, mode);
      } else if (mode === "off") {
        await paired.clearOverlay(deviceId);
      } else {
        const listed = await listZonesRaw();
        const zone = listed.find((z) => z.id === zoneId);
        const temp = zone?.targetTempC ?? 20;
        await paired.setTargetTemperature(deviceId, temp);
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

/** Zones without auto-off side effects (avoids recursion inside setPower). */
async function listZonesRaw(): Promise<Zone[]> {
  const bridge = getBridgeClient();
  const status = await bridge.getStatus();
  if (status.paired) {
    const devices = await bridge.listZones();
    const [meta, roomMap] = await Promise.all([
      getCachedZoneMetadata(),
      loadRoomMap(config.bridgeDataDir),
    ]);
    return aggregateRooms(devices, meta, roomMap).zones.map((z) =>
      applyOverlayHints(z),
    );
  }
  if (config.useMockZones) {
    return buildMockZones().map((z) => applyOverlayHints(z));
  }
  return [];
}

export async function quickActionAllOff(): Promise<void> {
  const listed = await listZonesRaw();
  for (const zone of listed) {
    await setZonePower(zone.id, "off");
  }
}

export async function quickActionBoost(durationMinutes = 30): Promise<void> {
  const listed = await listZonesRaw();
  for (const zone of listed) {
    await setZoneTemperature(zone.id, 25, { durationMinutes });
  }
}

export async function quickActionResumeSchedule(): Promise<void> {
  const listed = await listZonesRaw();
  for (const zone of listed) {
    if (zone.overlayActive) {
      await clearZoneOverlay(zone.id);
    }
  }
}

export async function updateOpenWindowSettings(
  patch: Partial<OpenWindowSettings>,
): Promise<OpenWindowSettings> {
  const current = await getOpenWindowSettings();
  return saveOpenWindowSettings(config.bridgeDataDir, {
    detectionEnabled:
      typeof patch.detectionEnabled === "boolean"
        ? patch.detectionEnabled
        : current.detectionEnabled !== false,
    globalAutoOff:
      typeof patch.globalAutoOff === "boolean"
        ? patch.globalAutoOff
        : current.globalAutoOff,
    resumeMode:
      patch.resumeMode === "clear_overlay" ||
      patch.resumeMode === "restore_setpoint"
        ? patch.resumeMode
        : current.resumeMode,
    rooms: patch.rooms ?? current.rooms,
  });
}

export async function setZoneWindowOpen(
  zoneId: string,
  open: boolean,
): Promise<void> {
  await setWindowOverride(config.bridgeDataDir, zoneId, open, "manual");
  if (config.useMockZones) {
    MOCK_ZONE_STATE.set(zoneId, {
      ...(MOCK_ZONE_STATE.get(zoneId) ?? {}),
      windowOpen: open,
      windowSource: "manual",
      windowDetectedAt: open ? new Date().toISOString() : null,
    });
  }
  // Trigger auto-off / resume once.
  await listZones();
}

export async function getHapCapabilitiesReport() {
  try {
    return await getHapBridgeClient().describeHapCapabilities();
  } catch {
    const bridge = getBridgeClient();
    if (bridge.describeHapCapabilities) {
      return bridge.describeHapCapabilities();
    }
    throw new Error("HAP capabilities not available");
  }
}

export { getOpenWindowSettings };
