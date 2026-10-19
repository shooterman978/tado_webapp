/**
 * Tado cloud routes — OAuth, metadata, Smart Schedule, shared CloudQuota.
 *
 * @package @heizplan/api
 */

import { Hono } from "hono";
import type { ZoneScheduleUpdate } from "@heizplan/shared";
import {
  beginCloudAuth,
  getCloudStatus,
  pollCloudAuth,
  syncZoneMetadata,
  unlinkCloud,
} from "../modules/cloud/service.js";
import {
  getCloudQuota,
  setCloudQuotaLimit,
  CloudQuotaExceededError,
} from "../modules/cloud/quota.js";
import {
  getZoneSchedule,
  isQuotaError,
  ScheduleNotLinkedError,
  ScheduleZoneUnresolvedError,
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

/** Refresh zone-name metadata from the cloud (requires linked account). */
cloudRoutes.post("/sync", async (c) => {
  try {
    const meta = await syncZoneMetadata();
    const status = await getCloudStatus();
    const quota = await getCloudQuota();
    return c.json({
      ok: true,
      syncedAt: meta.syncedAt,
      homeName: meta.homeName,
      deviceCount: Object.keys(meta.devices).length,
      cloud: status,
      quota,
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
 * Smart Schedule for a room (`room-z{cloudZoneId}` or numeric cloud id).
 * GET counts against CloudQuota (typically 3 cloud HTTP calls).
 */
cloudRoutes.get("/schedule/:roomId", async (c) => {
  const roomId = c.req.param("roomId");
  try {
    const { schedule, quota } = await getZoneSchedule(roomId);
    return c.json({ schedule, quota });
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
    const message = err instanceof Error ? err.message : "Schedule read failed";
    console.error("[cloud] schedule GET failed:", message);
    return c.json({ error: "schedule_read_failed", message }, 502);
  }
});

/**
 * Persist Home day blocks or Away config → official Tado app.
 * Manual "Jetzt synchronisieren" is GET; edits use PUT (auto-sync).
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

/** Alias for GET schedule — explicit "Jetzt synchronisieren" from the PWA. */
cloudRoutes.post("/schedule/:roomId/sync", async (c) => {
  const roomId = c.req.param("roomId");
  try {
    const { schedule, quota } = await getZoneSchedule(roomId);
    return c.json({ ok: true, schedule, quota });
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
