/**
 * Protocol / event log REST — filterable ring buffer for Heizplan › Protokoll.
 *
 * @package @heizplan/api
 */

import { Hono } from "hono";
import type {
  ProtocolActorKind,
  ProtocolEventCategory,
  ProtocolEventType,
} from "@heizplan/shared";
import {
  ALL_ACTORS,
  ALL_CATEGORIES,
  appendProtocolEvent,
  getProtocolEvents,
  PROTOCOL_ACTORS,
  PROTOCOL_CATEGORIES,
} from "../modules/protocol/event-log.js";

export const protocolRoutes = new Hono();

const CLIENT_CATEGORIES = new Set<ProtocolEventCategory>([
  "user",
  "feedback",
]);

const CLIENT_TYPES = new Set<ProtocolEventType>([
  "user.navigate",
  "user.settings",
  "feedback.error",
  "feedback.success",
]);

protocolRoutes.get("/events", async (c) => {
  const categoryRaw = c.req.query("category") ?? "all";
  const category =
    categoryRaw === "all" ||
    (PROTOCOL_CATEGORIES as string[]).includes(categoryRaw)
      ? (categoryRaw as ProtocolEventCategory | "all")
      : "all";
  const actorRaw = c.req.query("actor") ?? "all";
  const actor =
    actorRaw === "all" || (PROTOCOL_ACTORS as string[]).includes(actorRaw)
      ? (actorRaw as ProtocolActorKind | "all")
      : "all";
  const q = c.req.query("q") ?? undefined;
  const since = c.req.query("since") ?? undefined;
  const until = c.req.query("until") ?? undefined;
  const today = c.req.query("today");
  const limitRaw = c.req.query("limit");
  const limit = limitRaw ? Number(limitRaw) : undefined;
  const payload = await getProtocolEvents({
    category,
    actor,
    q,
    since,
    until,
    limit: Number.isFinite(limit) ? limit : undefined,
    todayOnly: today === "1" || today === "true",
  });
  return c.json(payload);
});

protocolRoutes.get("/categories", (c) => {
  return c.json({ categories: ALL_CATEGORIES, actors: ALL_ACTORS });
});

/**
 * Client-side breadcrumbs / feedback only — agent events come from server hooks.
 * Rejects other categories to avoid spoofing automation analysis.
 */
protocolRoutes.post("/events", async (c) => {
  try {
    const body = (await c.req.json().catch(() => null)) as {
      category?: string;
      type?: string;
      message?: string;
      roomId?: string | null;
      detail?: Record<string, string | number | boolean | null> | null;
    } | null;
    if (!body?.category || !body?.type || !body?.message) {
      return c.json(
        {
          error: "invalid_body",
          message: "category, type, message required",
        },
        400,
      );
    }
    const category = body.category as ProtocolEventCategory;
    const type = body.type as ProtocolEventType;
    if (!CLIENT_CATEGORIES.has(category) || !CLIENT_TYPES.has(type)) {
      return c.json(
        {
          error: "forbidden_type",
          message:
            "Nur user.navigate / user.settings / feedback.* vom Client erlaubt",
        },
        403,
      );
    }
    const entry = await appendProtocolEvent({
      category,
      type,
      message: body.message,
      roomId: body.roomId ?? null,
      actor:
        category === "user"
          ? { kind: "user", label: "Du" }
          : { kind: "system", label: "System" },
      detail: body.detail ?? null,
    });
    return c.json({ ok: true, entry });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Append failed";
    return c.json({ error: "append_failed", message }, 500);
  }
});
