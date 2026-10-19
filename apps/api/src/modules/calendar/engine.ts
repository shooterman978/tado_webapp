/**
 * CalendarOverride engine — match CalDAV events → HAP overlay (preferred)
 * or quota-checked cloud write. Priority: Calendar > Overlay > Cloud baseline.
 *
 * @package @heizplan/api
 */

import type {
  CalendarActiveOverride,
  CalendarEvaluateResult,
  CalendarRule,
} from "@heizplan/shared";
import { config } from "../../config.js";
import { getCloudQuota } from "../cloud/quota.js";
import {
  clearZoneOverlay,
  setZonePower,
  setZoneTemperature,
} from "../zones/service.js";
import type { CalDavEvent } from "./caldav.js";
import { estimatePreheatMinutes } from "./heatup.js";
import {
  selectActiveMatches,
  timingWindowBounds,
  type RuleRoomAction,
} from "./match.js";
import {
  loadActiveOverrides,
  saveActiveOverrides,
} from "./store.js";

function dataDir(): string {
  return config.bridgeDataDir;
}

function sameOverride(
  a: CalendarActiveOverride,
  roomId: string,
  ruleId: string,
  eventUid: string,
): boolean {
  return a.roomId === roomId && a.ruleId === ruleId && a.eventUid === eventUid;
}

function overlayDurationMinutes(
  roomId: string,
  action: RuleRoomAction,
): number {
  const now = Date.now();
  const bounds = timingWindowBounds(action.event, action.timing, {
    readyMinutesBefore: action.rule.readyMinutesBefore ?? 60,
    readyMinutesAfter: action.rule.readyMinutesAfter ?? 60,
    preheatMinutes: action.preheatMinutes,
    mode: action.mode,
  });
  if (!bounds) {
    return 60;
  }
  return Math.max(1, Math.ceil((bounds.windowEnd - now) / 60_000));
}

async function applyHap(
  roomId: string,
  action: RuleRoomAction,
): Promise<void> {
  if (action.mode === "off") {
    await setZonePower(roomId, "off");
    return;
  }

  const durationMinutes = overlayDurationMinutes(roomId, action);
  const temp = action.targetTempC ?? 20;
  await setZoneTemperature(roomId, temp, { durationMinutes });
}

async function collectPreheatEstimates(
  rules: CalendarRule[],
): Promise<Map<string, number>> {
  const ids = new Set<string>();
  for (const rule of rules) {
    for (const id of rule.roomIds) {
      ids.add(id);
    }
  }
  const map = new Map<string, number>();
  await Promise.all(
    [...ids].map(async (id) => {
      map.set(id, await estimatePreheatMinutes(id));
    }),
  );
  return map;
}

/**
 * Evaluate rules against fetched events and reconcile active overrides.
 * Cloud writes are skipped when quota.remaining === 0 (hap_overlay still runs).
 */
export async function reconcileOverrides(
  events: CalDavEvent[],
  rules: CalendarRule[],
  at = new Date(),
): Promise<CalendarEvaluateResult> {
  const preheatByRoom = await collectPreheatEstimates(rules);
  const desired = selectActiveMatches(events, rules, at, [], preheatByRoom);
  const previous = await loadActiveOverrides(dataDir());
  const quota = await getCloudQuota();

  let applied = 0;
  let cleared = 0;
  let skippedQuota = 0;
  const next: CalendarActiveOverride[] = [];

  for (const prev of previous) {
    const still = desired.get(prev.roomId);
    if (
      still &&
      sameOverride(prev, prev.roomId, still.rule.id, still.event.uid)
    ) {
      continue;
    }
    try {
      if (prev.applyPath === "hap_overlay") {
        await clearZoneOverlay(prev.roomId);
      }
      cleared += 1;
    } catch (err) {
      console.error(
        "[calendar] clear overlay failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  for (const [roomId, action] of desired) {
    const existing = previous.find((p) =>
      sameOverride(p, roomId, action.rule.id, action.event.uid),
    );
    if (existing) {
      next.push(existing);
      continue;
    }

    if (action.rule.applyPath === "cloud_write" && quota.remaining === 0) {
      skippedQuota += 1;
    }

    try {
      await applyHap(roomId, action);
      const record: CalendarActiveOverride = {
        ruleId: action.rule.id,
        ruleName: action.rule.name,
        roomId,
        eventUid: action.event.uid,
        eventSummary: action.event.summary,
        startsAt: action.event.startsAt,
        endsAt: action.event.endsAt,
        appliedAt: new Date().toISOString(),
        applyPath: "hap_overlay",
        targetTempC: action.targetTempC,
        mode: action.mode === "off" ? "off" : "heat",
        needsRestore: false,
      };
      next.push(record);
      applied += 1;
    } catch (err) {
      console.error(
        "[calendar] apply failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  await saveActiveOverrides(dataDir(), next);
  const freshQuota = await getCloudQuota();

  return {
    matched: desired.size,
    applied,
    cleared,
    skippedQuota,
    active: next,
    quota: freshQuota,
    eventsFetched: events.length,
    evaluatedAt: at.toISOString(),
    message:
      desired.size === 0
        ? "Keine aktiven Kalender-Treffer."
        : `KalenderOverride: ${desired.size} Raum/Räume · ${applied} neu · ${cleared} beendet` +
          (skippedQuota > 0
            ? ` · ${skippedQuota} Cloud-Write(s) übersprungen (Quota)`
            : ""),
  };
}
