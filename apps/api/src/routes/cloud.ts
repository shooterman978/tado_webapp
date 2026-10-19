/**
 * Tado cloud routes — OAuth, sparse home sync, cached Smart Schedule, CloudQuota.
 *
 * @package @heizplan/api
 */

import { Hono } from "hono";
import type { ZoneScheduleUpdate } from "@heizplan/shared";
import {
  beginCloudAuth,
  getCloudStatus,
  getCloudSyncStatus,
  pollCloudAuth,
  runHomeCloudSync,
  unlinkCloud,
} from "../modules/cloud/service.js";
import {
  getCloudQuota,
  getCloudQuotaLog,
  setCloudQuotaLimit,
  CloudQuotaExceededError,
} from "../modules/cloud/quota.js";
import {
  getCachedZoneSchedule,
  isQuotaError,
  ScheduleCacheMissError,
  ScheduleNotLinkedError,
  ScheduleZoneUnresolvedError,
  syncZoneScheduleFromCloud,
  updateZoneSchedule,
} from "../modules/cloud/schedule-service.js";

export const cloudRoutes = new Hono();

function quotaHttp(err: CloudQuotaExceededError) {
  return {
    body: {
      error: "cloud_quota_exceeded",
      message: err.message,
      quota: err.status,
    },
    status: 429 as const,
  };
}

cloudRoutes.get("/status", async (c) => {
  const status = await getCloudStatus();
  return c.json(status);
});

/** Disk-only home sync bookmark (no cloud HTTP). */
cloudRoutes.get("/sync", async (c) => {
  return c.json(await getCloudSyncStatus());
});

/** Shared daily budget for all cloud HTTP (not schedule-specific). */
cloudRoutes.get("/quota", async (c) => {
  return c.json(await getCloudQuota());
});

cloudRoutes.put("/quota", async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as { limit?: number };
    if (typeof body.limit !== "number") {
      return c.json({ error: "invalid_body", message: "limit (number) required" }, 400);
    }
    const quota = await setCloudQuotaLimit(body.limit);
    return c.json(quota);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Quota update failed";
    return c.json({ error: "quota_update_failed", message }, 400);
  }
});

/**
 * Audit log of counted cloud HTTP calls (ring buffer).
 * Query: ?today=1 (default) | today=0 for full buffer; ?limit=50
 */
cloudRoutes.get("/quota/log", async (c) => {
  const todayParam = c.req.query("today");
  const todayOnly = todayParam !== "0" && todayParam !== "false";
  const limitRaw = Number(c.req.query("limit") ?? "150");
  const limit = Number.isFinite(limitRaw) ? limitRaw : 150;
  return c.json(await getCloudQuotaLog({ todayOnly, limit }));
});

/** Start device-code login — open verificationUriComplete in a browser. */
cloudRoutes.post("/auth/start", async (c) => {
  try {
    const started = await beginCloudAuth();
    return c.json(started);
  } catch (err) {
    if (isQuotaError(err)) {
      const q = quotaHttp(err);
      return c.json(q.body, q.status);
    }
    const message = err instanceof Error ? err.message : "Auth start failed";
    console.error("[cloud] auth start failed:", message);
    return c.json({ error: "auth_start_failed", message }, 502);
  }
});

/** Poll until the user finishes browser authorization. */
cloudRoutes.post("/auth/poll", async (c) => {
  try {
    const result = await pollCloudAuth();
    const status =
      result.status === "linked"
        ? 200
        : result.status === "pending"
          ? 202
          : result.status === "expired"
            ? 410
            : 400;
    return c.json(result, status);
  } catch (err) {
    if (isQuotaError(err)) {
      const q = quotaHttp(err);
      return c.json(q.body, q.status);
    }
    const message = err instanceof Error ? err.message : "Auth poll failed";
    console.error("[cloud] auth poll failed:", message);
    return c.json({ error: "auth_poll_failed", message }, 502);
  }
});

/**
 * Explicit home cloud sync (metadata + openWindow snapshot).
 * Does not pull room schedules — those use POST /schedule/:roomId/sync.
 */
cloudRoutes.post("/sync", async (c) => {
  try {
    const result = await runHomeCloudSync();
    return c.json({
      ok: true,
      syncedAt: result.syncedAt,
      homeName: result.meta.homeName,
      deviceCount: Object.keys(result.meta.devices).length,
      openWindowCount: result.openWindowCount,
      cloud: await getCloudStatus(),
      sync: result.sync,
      quota: result.quota,
    });
  } catch (err) {
    if (isQuotaError(err)) {
      const q = quotaHttp(err);
      return c.json(q.body, q.status);
    }
    const message = err instanceof Error ? err.message : "Sync failed";
    console.error("[cloud] sync failed:", message);
    const code = message.includes("not linked") ? 409 : 502;
    return c.json({ error: "sync_failed", message }, code);
  }
});

/** Drop stored refresh/access tokens (keeps last zone-metadata cache). */
cloudRoutes.post("/unlink", async (c) => {
  await unlinkCloud();
  return c.json({ ok: true, cloud: await getCloudStatus(), quota: await getCloudQuota() });
});

/**
 * Smart Schedule from local disk cache — **no** cloud HTTP.
 * Cache miss → 404 `schedule_cache_miss` (user must tap sync).
 */
cloudRoutes.get("/schedule/:roomId", async (c) => {
  const roomId = c.req.param("roomId");
  try {
    const { schedule, quota, fromCache } = await getCachedZoneSchedule(roomId);
    return c.json({ schedule, quota, fromCache });
  } catch (err) {
    if (err instanceof ScheduleCacheMissError) {
      return c.json(
        {
          error: "schedule_cache_miss",
          message: err.message,
          quota: await getCloudQuota(),
        },
        404,
      );
    }
    if (err instanceof ScheduleNotLinkedError) {
      return c.json({ error: "cloud_not_linked", message: err.message }, 409);
    }
    if (err instanceof ScheduleZoneUnresolvedError) {
      return c.json({ error: "zone_unresolved", message: err.message }, 404);
    }
    const message = err instanceof Error ? err.message : "Schedule read failed";
    console.error("[cloud] schedule GET failed:", message);
    return c.json({ error: "schedule_read_failed", message }, 502);
  }
});

/**
 * Persist Home day blocks or Away config → official Tado app.
 * Room-enter never writes; edits use PUT.
 */
cloudRoutes.put("/schedule/:roomId", async (c) => {
  const roomId = c.req.param("roomId");
  try {
    const body = (await c.req.json()) as ZoneScheduleUpdate;
    if (body.presence !== "HOME" && body.presence !== "AWAY") {
      return c.json(
        { error: "invalid_body", message: 'presence must be "HOME" or "AWAY"' },
        400,
      );
    }
    const result = await updateZoneSchedule(roomId, body);
    return c.json(result);
  } catch (err) {
    if (isQuotaError(err)) {
      const q = quotaHttp(err);
      return c.json(q.body, q.status);
    }
    if (err instanceof ScheduleNotLinkedError) {
      return c.json({ error: "cloud_not_linked", message: err.message }, 409);
    }
    if (err instanceof ScheduleZoneUnresolvedError) {
      return c.json({ error: "zone_unresolved", message: err.message }, 404);
    }
    const message = err instanceof Error ? err.message : "Schedule write failed";
    if (
      message.includes("required") ||
      message.includes("must") ||
      message.includes("tempC") ||
      message.includes("dayType")
    ) {
      return c.json({ error: "invalid_body", message }, 400);
    }
    console.error("[cloud] schedule PUT failed:", message);
    return c.json({ error: "schedule_write_failed", message }, 502);
  }
});

/** Explicit "Jetzt synchronisieren" — pulls schedule from Tado cloud + caches. */
cloudRoutes.post("/schedule/:roomId/sync", async (c) => {
  const roomId = c.req.param("roomId");
  try {
    const { schedule, quota, fromCache } = await syncZoneScheduleFromCloud(roomId);
    return c.json({ ok: true, schedule, quota, fromCache });
  } catch (err) {
    if (isQuotaError(err)) {
      const q = quotaHttp(err);
      return c.json(q.body, q.status);
    }
    if (err instanceof ScheduleNotLinkedError) {
      return c.json({ error: "cloud_not_linked", message: err.message }, 409);
    }
    if (err instanceof ScheduleZoneUnresolvedError) {
      return c.json({ error: "zone_unresolved", message: err.message }, 404);
    }
    const message = err instanceof Error ? err.message : "Schedule sync failed";
    console.error("[cloud] schedule sync failed:", message);
    return c.json({ error: "schedule_sync_failed", message }, 502);
  }
});
