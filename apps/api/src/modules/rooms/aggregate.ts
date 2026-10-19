/**
 * Map HAP thermostat accessories → room tiles with friendly names.
 * Aggregates multiple devices that belong to the same Tado zone/room.
 *
 * @package @heizplan/api
 */

import type { Zone, ZoneNameSource, ZoneNamingInfo } from "@heizplan/shared";
import type { RoomMap, ZoneMetadata } from "../cloud/store.js";

/** Extract Tado-style serial from HAP accessory name. */
export function extractSerial(hapName: string): string | null {
  const match = hapName.match(/\b([A-Z]{2}[A-Z0-9]*\d{4,})\b/i);
  if (!match) {
    return null;
  }
  return match[1].toUpperCase();
}

function shortHapLabel(hapName: string): string {
  const serial = extractSerial(hapName);
  if (serial) {
    const kind = /radiator/i.test(hapName) ? "Radiator" : "Thermostat";
    return `${kind} · ${serial.slice(-4)}`;
  }
  return hapName.replace(/^tado\s+/i, "").trim() || hapName;
}

function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "room";
}

interface ResolvedName {
  roomKey: string;
  displayName: string;
  source: ZoneNameSource;
  cloudZoneId?: number;
}

function resolveName(
  device: Zone,
  meta: ZoneMetadata | null,
  roomMap: RoomMap,
): ResolvedName {
  const serial = extractSerial(device.name);
  if (serial && meta?.devices[serial]) {
    const z = meta.devices[serial];
    return {
      roomKey: `room-z${z.zoneId}`,
      displayName: z.zoneName,
      source: "cloud",
      cloudZoneId: z.zoneId,
    };
  }
  if (serial) {
    const mapped =
      roomMap[serial] ??
      roomMap[serial.toUpperCase()] ??
      roomMap[serial.toLowerCase()];
    if (mapped) {
      return {
        roomKey: `room-${slugify(mapped)}`,
        displayName: mapped,
        source: "map",
      };
    }
  }
  return {
    roomKey: `hap-${device.id}`,
    displayName: shortHapLabel(device.name),
    source: "hap",
  };
}

function avg(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

function modeOrAvg(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const counts = new Map<number, number>();
  for (const v of values) {
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best = values[0];
  let bestN = 0;
  for (const [v, n] of counts) {
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

/**
 * Fold bridge devices into room tiles using cloud metadata and/or room-map.
 */
export function aggregateRooms(
  devices: Zone[],
  meta: ZoneMetadata | null,
  roomMap: RoomMap,
): { zones: Zone[]; naming: ZoneNamingInfo } {
  const groups = new Map<
    string,
    {
      displayName: string;
      source: ZoneNameSource;
      members: Zone[];
    }
  >();

  let unresolved = 0;
  for (const device of devices) {
    const resolved = resolveName(device, meta, roomMap);
    if (resolved.source === "hap") {
      unresolved += 1;
    }
    const existing = groups.get(resolved.roomKey);
    if (existing) {
      existing.members.push(device);
      // Prefer cloud over map over hap if mixed (shouldn't happen often).
      if (
        (resolved.source === "cloud" && existing.source !== "cloud") ||
        (resolved.source === "map" && existing.source === "hap")
      ) {
        existing.source = resolved.source;
        existing.displayName = resolved.displayName;
      }
    } else {
      groups.set(resolved.roomKey, {
        displayName: resolved.displayName,
        source: resolved.source,
        members: [device],
      });
    }
  }

  const zones: Zone[] = [];
  for (const [roomKey, group] of groups) {
    const currents = group.members
      .map((m) => m.currentTempC)
      .filter((v): v is number => v !== null && Number.isFinite(v));
    const targets = group.members
      .map((m) => m.targetTempC)
      .filter((v): v is number => v !== null && Number.isFinite(v));
    const powers = group.members.map((m) => m.heatingPowerPercent ?? 0);
    const updatedAts = group.members
      .map((m) => m.updatedAt)
      .filter((v): v is string => Boolean(v))
      .sort();

    zones.push({
      id: roomKey,
      name: group.displayName,
      currentTempC: avg(currents),
      targetTempC: modeOrAvg(targets),
      overlayActive: group.members.some((m) => m.overlayActive),
      heatingPowerPercent: powers.length ? Math.max(...powers) : null,
      updatedAt: updatedAts.at(-1) ?? null,
      deviceIds: group.members.map((m) => m.id),
      deviceCount: group.members.length,
      nameSource: group.source,
    });
  }

  // Stable order: named rooms alphabetically, then unresolved HAP leftovers.
  zones.sort((a, b) => {
    const aHap = a.nameSource === "hap" ? 1 : 0;
    const bHap = b.nameSource === "hap" ? 1 : 0;
    if (aHap !== bHap) {
      return aHap - bHap;
    }
    return a.name.localeCompare(b.name, "de");
  });

  const sources = new Set(zones.map((z) => z.nameSource).filter(Boolean));
  let source: ZoneNamingInfo["source"] = "none";
  if (sources.has("cloud")) {
    source = "cloud";
  } else if (sources.has("map")) {
    source = "map";
  } else if (sources.has("hap")) {
    source = "hap";
  } else if (sources.has("mock")) {
    source = "mock";
  }

  return {
    zones,
    naming: {
      source,
      syncedAt: meta?.syncedAt ?? null,
      /** Caller fills from token store — metadata cache alone is not a live link. */
      cloudLinked: false,
      unresolvedDeviceCount: unresolved,
    },
  };
}

/** Expand a room tile id to underlying HAP accessory aids. */
export function resolveDeviceIds(
  zoneId: string,
  rooms: Zone[],
): string[] {
  const room = rooms.find((z) => z.id === zoneId);
  if (room?.deviceIds?.length) {
    return room.deviceIds;
  }
  // Backward-compat: raw HAP aid still accepted.
  if (/^\d+$/.test(zoneId)) {
    return [zoneId];
  }
  return [];
}
