/**
 * Resolve open-window state and run local auto-off / resume (no paywall).
 *
 * Priority: manual/fixture override → HAP ContactSensor → cloud openWindowDetected.
 * V3 Bridge HAP typically has no readable ContactSensor — see GET /api/bridge/hap-report.
 *
 * @package @heizplan/api
 */

import type { OpenWindowSettings, Zone } from "@heizplan/shared";
import { config } from "../../config.js";
import { getCloudOpenWindowByZoneId } from "../cloud/service.js";
import { getCachedZoneMetadata } from "../cloud/service.js";
import { extractSerial } from "../rooms/aggregate.js";
import {
  clearAutoOffSnapshot,
  getAutoOffSnapshot,
  isAutoOffEnabled,
  loadOpenWindowSettings,
  loadWindowOverrides,
  setAutoOffSnapshot,
  touchWindowDetectedAt,
  type ResolvedWindow,
} from "./open-window-store.js";
import { logProtocolEvent } from "../protocol/event-log.js";
import { noteWindowState } from "../protocol/trackers.js";
import { clearOverlayRecord } from "./overlay-store.js";

function dataDir(): string {
  return config.bridgeDataDir;
}

/** Merge window fields onto room tiles. */
export async function enrichZonesWithWindowState(
  zones: Zone[],
): Promise<Zone[]> {
  const [settings, overrides, cloudOpen, meta] = await Promise.all([
    loadOpenWindowSettings(dataDir()),
    loadWindowOverrides(dataDir()),
    getCloudOpenWindowByZoneId(),
    getCachedZoneMetadata(),
  ]);

  const serialToCloudZone = new Map<string, number>();
  if (meta) {
    for (const [serial, d] of Object.entries(meta.devices)) {
      serialToCloudZone.set(serial.toUpperCase(), d.zoneId);
    }
  }

  const detectionOn = settings.detectionEnabled !== false;

  return zones.map((zone) => {
    if (!detectionOn) {
      return {
        ...zone,
        windowOpen: false,
        windowSource: "none" as const,
        windowDetectedAt: null,
        openWindowAutoOffActive: false,
      };
    }
    const resolved = resolveWindow(zone, overrides, cloudOpen, serialToCloudZone);
    noteWindowState(zone.id, resolved.windowOpen, resolved.windowSource);
    const snapshotActive = false; // filled after auto-off pass
    return {
      ...zone,
      windowOpen: resolved.windowOpen,
      windowSource: resolved.windowSource,
      windowDetectedAt: resolved.windowDetectedAt,
      openWindowAutoOffActive: snapshotActive,
      devices: zone.devices?.map((d) => ({
        ...d,
        windowOpen:
          d.windowOpen ??
          (resolved.windowSource === "hap" ? resolved.windowOpen : d.windowOpen),
      })),
    };
  });
}

function resolveWindow(
  zone: Zone,
  overrides: Awaited<ReturnType<typeof loadWindowOverrides>>,
  cloudOpen: Record<number, boolean>,
  serialToCloudZone: Map<string, number>,
): ResolvedWindow {
  const override = overrides[zone.id];
  if (override) {
    return {
      windowOpen: override.open,
      windowSource: override.source === "fixture" ? "fixture" : "manual",
      windowDetectedAt: touchWindowDetectedAt(zone.id, override.open),
    };
  }

  if (zone.windowSource === "fixture" || zone.windowSource === "manual") {
    const open = zone.windowOpen === true;
    return {
      windowOpen: open,
      windowSource: zone.windowSource,
      windowDetectedAt: touchWindowDetectedAt(zone.id, open),
    };
  }

  const hapOpen =
    zone.windowSource === "hap"
      ? zone.windowOpen === true
      : zone.devices?.some((d) => d.windowOpen === true) === true;
  if (zone.windowSource === "hap" || hapOpen) {
    return {
      windowOpen: hapOpen,
      windowSource: "hap",
      windowDetectedAt: touchWindowDetectedAt(zone.id, hapOpen),
    };
  }

  let cloudZoneId: number | undefined;
  for (const device of zone.devices ?? []) {
    const serial =
      device.serialNo?.toUpperCase() ??
      extractSerial(device.name)?.toUpperCase() ??
      null;
    if (serial && serialToCloudZone.has(serial)) {
      cloudZoneId = serialToCloudZone.get(serial);
      break;
    }
  }
  if (cloudZoneId != null && cloudOpen[cloudZoneId] === true) {
    return {
      windowOpen: true,
      windowSource: "cloud",
      windowDetectedAt: touchWindowDetectedAt(zone.id, true),
    };
  }

  return {
    windowOpen: false,
    windowSource: "none",
    windowDetectedAt: touchWindowDetectedAt(zone.id, false),
  };
}

export type PowerActor = {
  setZonePower: (zoneId: string, mode: "heat" | "off") => Promise<void>;
  setZoneTemperature: (
    zoneId: string,
    tempC: number,
    opts?: { durationMinutes?: number | null },
  ) => Promise<void>;
  clearZoneOverlay: (zoneId: string) => Promise<void>;
};

/**
 * When window opens and auto-off is on → heat off (remember prior setpoint).
 * When window closes after auto-off → restore or clear overlay per settings.
 */
export async function processOpenWindowAutoOff(
  zones: Zone[],
  actor: PowerActor,
): Promise<Zone[]> {
  const settings = await loadOpenWindowSettings(dataDir());
  const out: Zone[] = [];

  for (const zone of zones) {
    const snapshot = await getAutoOffSnapshot(dataDir(), zone.id);
    const enabled = isAutoOffEnabled(settings, zone.id);
    let next = { ...zone, openWindowAutoOffActive: Boolean(snapshot) };

    if (zone.windowOpen && enabled && !snapshot) {
      const previousMode: "heat" | "off" =
        zone.targetTempC == null && !zone.overlayActive ? "off" : "heat";
      if (previousMode === "heat") {
        await setAutoOffSnapshot(dataDir(), {
          zoneId: zone.id,
          previousTargetTempC: zone.targetTempC,
          previousMode,
          triggeredAt: new Date().toISOString(),
        });
        try {
          clearOverlayRecord(zone.id);
          await actor.setZonePower(zone.id, "off");
          next = {
            ...next,
            targetTempC: null,
            overlayActive: false,
            onSchedule: false,
            openWindowAutoOffActive: true,
          };
          console.info(
            `[open-window] auto-off ${zone.id} (resume=${settings.resumeMode})`,
          );
          logProtocolEvent({
            category: "window",
            type: "window.auto_off",
            message: "Fenster-Auto-Aus aktiv",
            roomId: zone.id,
            detail: { resumeMode: settings.resumeMode },
          });
        } catch (err) {
          await clearAutoOffSnapshot(dataDir(), zone.id);
          console.warn(
            `[open-window] auto-off failed ${zone.id}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    } else if (!zone.windowOpen && snapshot) {
      try {
        await resumeAfterWindowClose(zone.id, snapshot, settings, actor);
        await clearAutoOffSnapshot(dataDir(), zone.id);
        next = {
          ...next,
          openWindowAutoOffActive: false,
          targetTempC:
            settings.resumeMode === "restore_setpoint"
              ? snapshot.previousTargetTempC
              : next.targetTempC,
          overlayActive:
            settings.resumeMode === "restore_setpoint"
              ? snapshot.previousTargetTempC != null
              : false,
        };
        console.info(`[open-window] resumed ${zone.id} (${settings.resumeMode})`);
        logProtocolEvent({
          category: "window",
          type: "window.resume",
          message: "Heizung nach Fenster wieder an",
          roomId: zone.id,
          detail: { resumeMode: settings.resumeMode },
        });
      } catch (err) {
        console.warn(
          `[open-window] resume failed ${zone.id}:`,
          err instanceof Error ? err.message : err,
        );
        next = { ...next, openWindowAutoOffActive: true };
      }
    }

    out.push(next);
  }

  return out;
}

async function resumeAfterWindowClose(
  zoneId: string,
  snapshot: Awaited<ReturnType<typeof getAutoOffSnapshot>>,
  settings: OpenWindowSettings,
  actor: PowerActor,
): Promise<void> {
  if (!snapshot) {
    return;
  }
  if (settings.resumeMode === "clear_overlay") {
    await actor.clearZoneOverlay(zoneId);
    return;
  }
  // Default: restore previous setpoint (or heat mode if temp unknown).
  if (
    snapshot.previousMode === "heat" &&
    snapshot.previousTargetTempC != null &&
    Number.isFinite(snapshot.previousTargetTempC)
  ) {
    await actor.setZoneTemperature(zoneId, snapshot.previousTargetTempC, {
      durationMinutes: null,
    });
    return;
  }
  if (snapshot.previousMode === "heat") {
    await actor.setZonePower(zoneId, "heat");
    return;
  }
  await actor.setZonePower(zoneId, "off");
}

export async function getOpenWindowSettings(): Promise<OpenWindowSettings> {
  return loadOpenWindowSettings(dataDir());
}

export { saveOpenWindowSettings, setWindowOverride, clearWindowOverride } from "./open-window-store.js";
