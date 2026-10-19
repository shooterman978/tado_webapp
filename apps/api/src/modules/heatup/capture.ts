/**
 * Detect heat-up sessions from zone observations and finalize samples.
 *
 * Lifecycle patterns (design only) from dbullendsl/hvac-comfort-start (MIT):
 * - Arrival-bounded: learn only start → first reach (then close session).
 * - Caps / window / manual abort → rejected (observation-only; no model update).
 *
 * @package @heizplan/api
 */

import type { Zone } from "@heizplan/shared";
import { HEATUP_DEFAULTS } from "./defaults.js";
import {
  appendSample,
  buildSample,
  clearSession,
  getSession,
  setSession,
  type ActiveHeatupSession,
} from "./sample-store.js";
import { tryOutdoorTemperature } from "./outdoor.js";

export interface ObserveResult {
  roomId: string;
  action:
    | "none"
    | "started"
    | "progress"
    | "completed"
    | "rejected"
    | "aborted";
  sampleId?: string;
  reason?: string;
}

function minutesBetween(startIso: string, endIso: string): number {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  return Math.max(0, ms / 60_000);
}

function isHeatingIntent(zone: Zone): boolean {
  if (zone.targetTempC == null || zone.currentTempC == null) {
    return false;
  }
  if (zone.openWindowAutoOffActive) {
    return false;
  }
  const delta = zone.targetTempC - zone.currentTempC;
  if (delta < HEATUP_DEFAULTS.minDeltaC) {
    return false;
  }
  // Heat active: power percent > 0, or overlay / schedule heating toward higher target.
  if (zone.heatingPowerPercent != null && zone.heatingPowerPercent > 0) {
    return true;
  }
  return zone.targetTempC > zone.currentTempC;
}

/**
 * Process one zone snapshot. Call from zone list refresh or POST observe.
 */
export async function observeZoneHeatup(
  dataDir: string,
  zone: Zone,
  nowIso: string = new Date().toISOString(),
): Promise<ObserveResult> {
  const roomId = zone.id;
  const session = await getSession(dataDir, roomId);
  const current = zone.currentTempC;
  const target = zone.targetTempC;

  if (session) {
    return continueSession(dataDir, zone, session, nowIso);
  }

  if (current == null || target == null || !isHeatingIntent(zone)) {
    return { roomId, action: "none" };
  }

  if (zone.windowOpen) {
    return { roomId, action: "none", reason: "window_open" };
  }

  const outdoor = await tryOutdoorTemperature();
  const next: ActiveHeatupSession = {
    roomId,
    startedAt: nowIso,
    startTempC: current,
    targetTempC: target,
    outdoorTempC: outdoor?.tempC ?? null,
    lastCurrentTempC: current,
    lastProgressAt: nowIso,
    windowOpenSeen: false,
  };
  await setSession(dataDir, next);
  return { roomId, action: "started" };
}

async function continueSession(
  dataDir: string,
  zone: Zone,
  session: ActiveHeatupSession,
  nowIso: string,
): Promise<ObserveResult> {
  const roomId = zone.id;
  const current = zone.currentTempC;
  const target = zone.targetTempC;
  const duration = minutesBetween(session.startedAt, nowIso);

  if (zone.windowOpen) {
    session.windowOpenSeen = true;
  }

  // Manual abort: power off / no target.
  if (target == null || (zone.heatingPowerPercent === 0 && current != null && current < session.targetTempC - HEATUP_DEFAULTS.reachToleranceC)) {
    return finalizeReject(dataDir, session, nowIso, "manual_abort");
  }

  // Target changed significantly.
  if (
    Math.abs(target - session.targetTempC) >= HEATUP_DEFAULTS.targetChangeAbortC
  ) {
    return finalizeReject(dataDir, session, nowIso, "target_changed");
  }

  if (session.windowOpenSeen || zone.windowOpen) {
    return finalizeReject(dataDir, session, nowIso, "window_open");
  }

  if (duration >= HEATUP_DEFAULTS.maxDurationMinutes) {
    return finalizeReject(dataDir, session, nowIso, "stalled");
  }

  if (current != null) {
    if (current > session.lastCurrentTempC + 0.05) {
      session.lastCurrentTempC = current;
      session.lastProgressAt = nowIso;
      await setSession(dataDir, session);
    } else {
      const stalledFor = minutesBetween(session.lastProgressAt, nowIso);
      if (
        stalledFor >= HEATUP_DEFAULTS.stallWindowMinutes &&
        current < session.startTempC + HEATUP_DEFAULTS.stallRiseC
      ) {
        return finalizeReject(dataDir, session, nowIso, "stalled");
      }
    }

    // Reached target.
    if (current >= session.targetTempC - HEATUP_DEFAULTS.reachToleranceC) {
      if (duration < HEATUP_DEFAULTS.minDurationMinutes) {
        return finalizeReject(dataDir, session, nowIso, "too_short");
      }
      const delta = session.targetTempC - session.startTempC;
      if (delta < HEATUP_DEFAULTS.minDeltaC) {
        return finalizeReject(dataDir, session, nowIso, "delta_too_small");
      }
      const sample = await appendSample(
        dataDir,
        buildSample({
          roomId,
          startedAt: session.startedAt,
          endedAt: nowIso,
          startTempC: session.startTempC,
          targetTempC: session.targetTempC,
          outdoorTempC: session.outdoorTempC,
          durationMinutes: Number(duration.toFixed(1)),
          quality: "ok",
        }),
      );
      await clearSession(dataDir, roomId);
      return { roomId, action: "completed", sampleId: sample.id };
    }
  }

  await setSession(dataDir, {
    ...session,
    lastCurrentTempC: current ?? session.lastCurrentTempC,
  });
  return { roomId, action: "progress" };
}

async function finalizeReject(
  dataDir: string,
  session: ActiveHeatupSession,
  nowIso: string,
  reason: "window_open" | "manual_abort" | "target_changed" | "too_short" | "stalled" | "delta_too_small",
): Promise<ObserveResult> {
  const duration = minutesBetween(session.startedAt, nowIso);
  const sample = await appendSample(
    dataDir,
    buildSample({
      roomId: session.roomId,
      startedAt: session.startedAt,
      endedAt: nowIso,
      startTempC: session.startTempC,
      targetTempC: session.targetTempC,
      outdoorTempC: session.outdoorTempC,
      durationMinutes: Number(duration.toFixed(1)),
      quality: "rejected",
      rejectReason: reason,
    }),
  );
  await clearSession(dataDir, session.roomId);
  return {
    roomId: session.roomId,
    action: "rejected",
    sampleId: sample.id,
    reason,
  };
}
