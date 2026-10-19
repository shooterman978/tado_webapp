/**
 * Calendar / CalDAV routes — connection, rules CRUD, evaluate.
 * Secrets (app password) are write-only and never echoed.
 *
 * @package @heizplan/api
 */

import { Hono } from "hono";
import type { CalendarConnectionUpdate, CalendarRule } from "@heizplan/shared";
import { CalDavError } from "../modules/calendar/caldav.js";
import {
  createRule,
  disconnectCalendar,
  evaluateCalendar,
  getCalendarStatus,
  getConnectionStatus,
  listRules,
  refreshCalendarList,
  removeRule,
  updateConnection,
  updateRule,
} from "../modules/calendar/service.js";

export const calendarRoutes = new Hono();

calendarRoutes.get("/status", async (c) => {
  return c.json(await getCalendarStatus());
});

calendarRoutes.get("/connection", async (c) => {
  return c.json(await getConnectionStatus());
});

calendarRoutes.put("/connection", async (c) => {
  try {
    const body = (await c.req.json()) as CalendarConnectionUpdate;
    // Strip accidental password echo from any client debug fields.
    const status = await updateConnection({
      url: body.url,
      username: body.username,
      appPassword: body.appPassword,
    });
    return c.json(status);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Connection save failed";
    if (err instanceof CalDavError) {
      return c.json({ error: "caldav_failed", message }, 502);
    }
    const status =
      message.includes("required") || message.includes("must") ? 400 : 502;
    return c.json({ error: "connection_failed", message }, status);
  }
});

calendarRoutes.delete("/connection", async (c) => {
  return c.json(await disconnectCalendar());
});

calendarRoutes.post("/connection/refresh", async (c) => {
  try {
    return c.json(await refreshCalendarList());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Refresh failed";
    const code = err instanceof CalDavError ? 502 : 409;
    return c.json({ error: "caldav_refresh_failed", message }, code);
  }
});

calendarRoutes.get("/rules", async (c) => {
  return c.json({ rules: await listRules() });
});

calendarRoutes.post("/rules", async (c) => {
  try {
    const body = (await c.req.json()) as Partial<CalendarRule>;
    const rule = await createRule(body);
    return c.json(rule, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Create rule failed";
    return c.json({ error: "invalid_rule", message }, 400);
  }
});

calendarRoutes.put("/rules/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const body = (await c.req.json()) as Partial<CalendarRule>;
    const rule = await updateRule(id, body);
    return c.json(rule);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Update rule failed";
    const status = message.includes("not found") ? 404 : 400;
    return c.json({ error: "invalid_rule", message }, status);
  }
});

calendarRoutes.delete("/rules/:id", async (c) => {
  const id = c.req.param("id");
  const ok = await removeRule(id);
  if (!ok) {
    return c.json({ error: "not_found", message: `Rule not found: ${id}` }, 404);
  }
  return c.json({ ok: true, id });
});

/** Fetch CalDAV + apply CalendarOverride (HAP preferred, quota-aware). */
calendarRoutes.post("/evaluate", async (c) => {
  try {
    const result = await evaluateCalendar();
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Evaluate failed";
    if (message.includes("not configured")) {
      return c.json({ error: "caldav_not_configured", message }, 409);
    }
    const code = err instanceof CalDavError ? 502 : 502;
    return c.json({ error: "evaluate_failed", message }, code);
  }
});
