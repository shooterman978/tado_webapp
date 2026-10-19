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
  CalendarRuleTiming,
} from "@heizplan/shared";
import { config } from "../../config.js";
import { getCloudQuota } from "../cloud/quota.js";
import {
  clearZoneOverlay,
  setZonePower,
  setZoneTemperature,
} from "../zones/service.js";
import type { CalDavEvent } from "./caldav.js";
import { selectActiveMatches, type RuleRoomAction } from "./match.js";
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
  event: CalDavEvent,
  timing: CalendarRuleTiming,
): number {
  const now = Date.now();
  const start = Date.parse(event.startsAt);
  const end = Date.parse(event.endsAt);
  if (timing === "at_end") {
    return 120;
  }
  if (timing === "at_start") {
    const until = Math.min(end, start + 30 * 60_000);
    return Math.max(1, Math.ceil((until - now) / 60_000));
  }
  return Math.max(1, Math.ceil((end - now) / 60_000));
}

async function applyHap(
  roomId: string,
  action: RuleRoomAction,
): Promise<void> {
  const timing = action.rule.timing ?? "during";
  const durationMinutes = overlayDurationMinutes(action.event, timing);

  if (action.mode === "off") {
    await setZonePower(roomId, "off");
    return;
  }

  const temp = action.targetTempC ?? 20;
  await setZoneTemperature(roomId, temp, { durationMinutes });
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
  const desired = selectActiveMatches(events, rules, at);
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
