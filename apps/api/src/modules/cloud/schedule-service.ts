/**
 * Smart Schedule orchestration — cloud GET/PUT with quota-aware writes.
 *
 * CalendarOverride (see modules/calendar) sits *above* this module:
 *   1. Baseline via {@link getZoneSchedule} / local cache.
 *   2. Time-bounded calendar rules → HAP overlay (preferred, 0 cloud) or
 *      temporary cloud write (same CloudQuota; check remaining / resetsAt).
 *   Priority: CalendarOverride > manual room overlay > Smart Schedule (cloud).
 *
 * @package @heizplan/api
 */

import type {
  AwayConfiguration,
  CloudQuotaStatus,
  ScheduleBlock,
  ScheduleDayType,
  SchedulePresence,
  ZoneSchedule,
  ZoneScheduleUpdate,
} from "@heizplan/shared";
import { config } from "../../config.js";
import {
  dayTypesForTimetable,
  fetchZoneSchedule,
  putActiveTimetable,
  putAwayConfiguration,
  putHomeDayBlocks,
  refreshAccessToken,
} from "./client.js";
import {
  CloudQuotaExceededError,
  getCloudQuota,
  runCloudRequestGroup,
} from "./quota.js";
import {
  loadCloudTokens,
  loadScheduleCache,
  loadZoneMetadata,
  saveCloudTokens,
  saveScheduleCacheEntry,
  type ZoneMetadata,
} from "./store.js";

export class ScheduleNotLinkedError extends Error {
  constructor(message = "Cloud not linked — start device auth first.") {
    super(message);
    this.name = "ScheduleNotLinkedError";
  }
}

export class ScheduleZoneUnresolvedError extends Error {
  constructor(roomId: string) {
    super(`No cloud zone mapped for room "${roomId}". Sync metadata first.`);
    this.name = "ScheduleZoneUnresolvedError";
  }
}

export class ScheduleCacheMissError extends Error {
  constructor(roomId: string) {
    super(
      `Kein lokaler Zeitplan-Cache für "${roomId}". Bitte „Jetzt synchronisieren“ tippen.`,
    );
    this.name = "ScheduleCacheMissError";
  }
}

function dataDir(): string {
  return config.bridgeDataDir;
}

async function ensureAccessToken(): Promise<string> {
  const tokens = await loadCloudTokens(dataDir());
  if (!tokens) {
    throw new ScheduleNotLinkedError();
  }
  if (Date.now() < tokens.expiresAt - 5_000) {
    return tokens.accessToken;
  }
  const next = await refreshAccessToken(tokens.refreshToken);
  await saveCloudTokens(dataDir(), next);
  return next.accessToken;
}

/** Parse `room-z12` → 12, or accept bare numeric cloud zone ids. */
export function parseCloudZoneId(roomId: string): number | null {
  const slug = roomId.match(/^room-z(\d+)$/i);
  if (slug) {
    return Number(slug[1]);
  }
  if (/^\d+$/.test(roomId)) {
    return Number(roomId);
  }
  return null;
}

function resolveZone(
  roomId: string,
  meta: ZoneMetadata | null,
): { cloudZoneId: number; zoneName: string } {
  const fromSlug = parseCloudZoneId(roomId);
  if (fromSlug != null && meta) {
    const hit = Object.values(meta.devices).find((d) => d.zoneId === fromSlug);
    if (hit) {
      return { cloudZoneId: hit.zoneId, zoneName: hit.zoneName };
    }
    return { cloudZoneId: fromSlug, zoneName: `Zone ${fromSlug}` };
  }
  if (fromSlug != null) {
    return { cloudZoneId: fromSlug, zoneName: `Zone ${fromSlug}` };
  }
  if (meta) {
    const byName = Object.values(meta.devices).find(
      (d) => d.zoneName === roomId || `room-${d.zoneId}` === roomId,
    );
    if (byName) {
      return { cloudZoneId: byName.zoneId, zoneName: byName.zoneName };
    }
  }
  throw new ScheduleZoneUnresolvedError(roomId);
}

async function resolveRoomKey(roomId: string): Promise<{
  roomKey: string;
  cloudZoneId: number;
  zoneName: string;
  homeId: number;
}> {
  const meta = await loadZoneMetadata(dataDir());
  if (!meta?.homeId) {
    throw new ScheduleNotLinkedError(
      "Cloud metadata missing — link account and POST /api/cloud/sync first.",
    );
  }
  const { cloudZoneId, zoneName } = resolveZone(roomId, meta);
  const roomKey = roomId.startsWith("room-") ? roomId : `room-z${cloudZoneId}`;
  return { roomKey, cloudZoneId, zoneName, homeId: meta.homeId };
}

/**
 * Read schedule from local disk cache — **no** cloud HTTP.
 * Hook: CalendarOverride should use this for the baseline when possible.
 */
export async function getCachedZoneSchedule(roomId: string): Promise<{
  schedule: ZoneSchedule;
  quota: CloudQuotaStatus;
  fromCache: true;
}> {
  const { roomKey } = await resolveRoomKey(roomId);
  const cache = await loadScheduleCache(dataDir());
  const schedule = cache.schedules[roomKey];
  if (!schedule) {
    throw new ScheduleCacheMissError(roomKey);
  }
  return { schedule, quota: await getCloudQuota(), fromCache: true };
}

/**
 * Pull Smart Schedule from Tado cloud (counts against CloudQuota) and cache it.
 * Only call from an explicit user action (sync button) — never on room enter.
 */
export async function syncZoneScheduleFromCloud(roomId: string): Promise<{
  schedule: ZoneSchedule;
  quota: CloudQuotaStatus;
  fromCache: false;
}> {
  return runCloudRequestGroup("Schedule sync", async () => {
    const { roomKey, cloudZoneId, zoneName, homeId } = await resolveRoomKey(roomId);
    const accessToken = await ensureAccessToken();
    const schedule = await fetchZoneSchedule(
      accessToken,
      homeId,
      cloudZoneId,
      roomKey,
      zoneName,
    );
    await saveScheduleCacheEntry(dataDir(), roomKey, schedule);
    return { schedule, quota: await getCloudQuota(), fromCache: false as const };
  });
}

export async function listScheduleCacheTimes(): Promise<Record<string, string>> {
  const cache = await loadScheduleCache(dataDir());
  const out: Record<string, string> = {};
  for (const [id, schedule] of Object.entries(cache.schedules)) {
    if (schedule?.fetchedAt) {
      out[id] = schedule.fetchedAt;
    }
  }
  return out;
}

function assertDayType(
  timetableTypeId: 0 | 1 | 2,
  dayType: ScheduleDayType,
): void {
  const allowed = dayTypesForTimetable(timetableTypeId);
  if (!allowed.includes(dayType)) {
    throw new Error(
      `dayType ${dayType} is not valid for timetable ${timetableTypeId}`,
    );
  }
}

function validateBlocks(dayType: ScheduleDayType, blocks: ScheduleBlock[]): void {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    throw new Error("blocks must be a non-empty array covering the day");
  }
  for (const b of blocks) {
    if (b.dayType && b.dayType !== dayType) {
      throw new Error(`block dayType ${b.dayType} must match ${dayType}`);
    }
    if (b.power === "ON" && (typeof b.tempC !== "number" || b.tempC < 5 || b.tempC > 30)) {
      throw new Error("ON blocks need tempC between 5 and 30");
    }
  }
}

/**
 * Persist schedule edits to the Tado cloud (visible in the official app).
 * Counts every underlying HTTP call against CloudQuota.
 *
 * Hook: CalendarOverride must not bypass this without also checking
 * {@link getCloudQuota} — temporary cloud overwrites compete for the same budget.
 * Prefer local HAP overlays for short calendar events when possible.
 */
export async function updateZoneSchedule(
  roomId: string,
  update: ZoneScheduleUpdate,
): Promise<{
  schedule: ZoneSchedule;
  quota: CloudQuotaStatus;
  presence: SchedulePresence;
}> {
  return runCloudRequestGroup("Schedule speichern", async () => {
    const meta = await loadZoneMetadata(dataDir());
    if (!meta?.homeId) {
      throw new ScheduleNotLinkedError(
        "Cloud metadata missing — link account and POST /api/cloud/sync first.",
      );
    }
    const { cloudZoneId, zoneName } = resolveZone(roomId, meta);
    const accessToken = await ensureAccessToken();
    const roomKey = roomId.startsWith("room-") ? roomId : `room-z${cloudZoneId}`;

    if (update.presence === "AWAY") {
      if (!update.away) {
        throw new Error('away payload required when presence is "AWAY"');
      }
      const away: AwayConfiguration = {
        power: update.away.power === "OFF" ? "OFF" : "ON",
        tempC:
          update.away.power === "OFF"
            ? null
            : typeof update.away.tempC === "number"
              ? update.away.tempC
              : 5,
      };
      await putAwayConfiguration(accessToken, meta.homeId, cloudZoneId, away);
    } else {
      if (!update.dayType || !update.blocks) {
        throw new Error('dayType and blocks required when presence is "HOME"');
      }
      // UI always sends timetableTypeId from the last GET — avoids an extra cloud round-trip.
      const timetableTypeId = update.timetableTypeId;
      if (timetableTypeId == null) {
        throw new Error("timetableTypeId required when presence is HOME");
      }
      if (update.switchActiveTimetable === true) {
        await putActiveTimetable(
          accessToken,
          meta.homeId,
          cloudZoneId,
          timetableTypeId,
        );
      }
      assertDayType(timetableTypeId, update.dayType);
      validateBlocks(update.dayType, update.blocks);
      await putHomeDayBlocks(
        accessToken,
        meta.homeId,
        cloudZoneId,
        timetableTypeId,
        update.dayType,
        update.blocks.map((b) => ({ ...b, dayType: update.dayType! })),
      );
    }

    // Nested "Schedule lesen" group is skipped — stays under "Schedule speichern".
    const schedule = await fetchZoneSchedule(
      accessToken,
      meta.homeId,
      cloudZoneId,
      roomKey,
      zoneName,
    );
    await saveScheduleCacheEntry(dataDir(), roomKey, schedule);
    return {
      schedule,
      quota: await getCloudQuota(),
      presence: update.presence,
    };
  });
}

export function isQuotaError(err: unknown): err is CloudQuotaExceededError {
  return err instanceof CloudQuotaExceededError;
}
