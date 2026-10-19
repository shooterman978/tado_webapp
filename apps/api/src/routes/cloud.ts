/**
 * Tado cloud metadata routes — names only (device-code OAuth).
 *
 * @package @heizplan/api
 */

import { Hono } from "hono";
import {
  beginCloudAuth,
  getCloudStatus,
  pollCloudAuth,
  syncZoneMetadata,
  unlinkCloud,
} from "../modules/cloud/service.js";

export const cloudRoutes = new Hono();

cloudRoutes.get("/status", async (c) => {
  const status = await getCloudStatus();
  return c.json(status);
});

/** Start device-code login — open verificationUriComplete in a browser. */
cloudRoutes.post("/auth/start", async (c) => {
  try {
    const started = await beginCloudAuth();
    return c.json(started);
  } catch (err) {
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
    return c.json({
      ok: true,
      syncedAt: meta.syncedAt,
      homeName: meta.homeName,
      deviceCount: Object.keys(meta.devices).length,
      cloud: status,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    console.error("[cloud] sync failed:", message);
    const code = message.includes("not linked") ? 409 : 502;
    return c.json({ error: "sync_failed", message }, code);
  }
});

/** Drop stored refresh/access tokens (keeps last zone-metadata cache). */
cloudRoutes.post("/unlink", async (c) => {
  await unlinkCloud();
  return c.json({ ok: true, cloud: await getCloudStatus() });
});
