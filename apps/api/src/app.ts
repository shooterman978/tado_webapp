/**
 * HTTP application — Hono router.
 *
 * @package @heizplan/api
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { bridgeRoutes } from "./routes/bridge.js";
import { calendarRoutes } from "./routes/calendar.js";
import { cloudRoutes } from "./routes/cloud.js";
import { healthRoutes } from "./routes/health.js";
import { heatupRoutes } from "./routes/heatup.js";
import { zonesRoutes } from "./routes/zones.js";

export function createApp(): Hono {
  const app = new Hono();

  app.use("*", logger());
  app.use(
    "*",
    cors({
      origin: (origin) => origin || "*",
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
    }),
  );

  app.route("/api/health", healthRoutes);
  app.route("/api/zones", zonesRoutes);
  app.route("/api/bridge", bridgeRoutes);
  app.route("/api/cloud", cloudRoutes);
  app.route("/api/calendar", calendarRoutes);
  app.route("/api/heatup", heatupRoutes);

  app.get("/", (c) =>
    c.json({
      name: "heizplan-api",
      docs: "See repository README",
      endpoints: [
        "/api/health",
        "/api/zones",
        "/api/zones/settings/open-window",
        "/api/bridge/status",
        "/api/bridge/hap-report",
        "/api/cloud/status",
        "/api/cloud/quota",
        "/api/cloud/quota/log",
        "/api/cloud/schedule/:roomId",
        "/api/calendar/status",
        "/api/calendar/rules",
        "/api/calendar/evaluate",
        "/api/heatup/status",
        "/api/heatup/rooms/:roomId/prediction",
      ],
    }),
  );

  app.notFound((c) => c.json({ error: "not_found" }, 404));

  app.onError((err, c) => {
    console.error("[api]", err);
    return c.json({ error: "internal_error", message: "Unexpected error" }, 500);
  });

  return app;
}
