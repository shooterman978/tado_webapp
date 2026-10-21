/**
 * Persistent protocol event ring buffer (Heizplan › Protokoll).
 * File: BRIDGE_DATA_DIR/protocol-events.json — no secrets.
 *
 * @package @heizplan/api
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  CloudQuotaLogEntry,
  ProtocolEvent,
  ProtocolEventCategory,
  ProtocolEventsResponse,
  ProtocolEventType,
} from "@heizplan/shared";
import { config } from "../../config.js";
import { berlinDayKey, getCloudQuotaLog } from "../cloud/quota.js";

const LOG_FILE = "protocol-events.json";
const MAX_LOG_ENTRIES = 400;

const ALL_CATEGORIES: ProtocolEventCategory[] = [
  "polling",
  "user",
  "feedback",
  "calendar",
  "presence",
  "quota",
  "window",
  "heatup",
  "schedule",
  "bridge",
  "system",
];

interface LogFile {
  entries: ProtocolEvent[];
  updatedAt: string;
}

export interface ProtocolEventInput {
  category: ProtocolEventCategory;
  type: ProtocolEventType;
  message: string;
  roomId?: string | null;
  detail?: Record<string, string | number | boolean | null> | null;
  /** Optional override timestamp (tests / backfill). */
  at?: string;
}

function dataDir(): string {
  return config.bridgeDataDir;
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeDetail(
  detail: ProtocolEventInput["detail"],
): Record<string, string | number | boolean | null> | null {
  if (!detail || typeof detail !== "object") {
    return null;
  }
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (key.length > 64) {
      continue;
    }
    const lower = key.toLowerCase();
    if (
      lower.includes("token") ||
      lower.includes("secret") ||
      lower.includes("password") ||
      lower.includes("pin") ||
      lower.includes("authorization")
    ) {
      continue;
    }
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      if (typeof value === "string" && value.length > 400) {
        out[key] = `${value.slice(0, 397)}…`;
      } else {
        out[key] = value;
      }
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as T;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), {
    mode: 0o600,
    encoding: "utf8",
  });
  await fs.rename(tmp, file);
}

async function loadLog(): Promise<LogFile> {
  const existing = await readJson<LogFile>(path.join(dataDir(), LOG_FILE));
  if (!existing || !Array.isArray(existing.entries)) {
    return { entries: [], updatedAt: new Date().toISOString() };
  }
  return existing;
}

/**
 * Append one protocol event. Never throws to callers (best-effort).
 */
export async function appendProtocolEvent(
  input: ProtocolEventInput,
): Promise<ProtocolEvent | null> {
  try {
    const at = input.at ?? new Date().toISOString();
    const entry: ProtocolEvent = {
      id: newId(),
      at,
      dayKey: berlinDayKey(new Date(at)),
      category: input.category,
      type: input.type,
      message: String(input.message || input.type).slice(0, 240),
      roomId: input.roomId ?? null,
      detail: sanitizeDetail(input.detail ?? null),
    };
    const log = await loadLog();
    log.entries.push(entry);
    if (log.entries.length > MAX_LOG_ENTRIES) {
      log.entries = log.entries.slice(-MAX_LOG_ENTRIES);
    }
    log.updatedAt = new Date().toISOString();
    await writeJson(path.join(dataDir(), LOG_FILE), log);
    return entry;
  } catch (err) {
    console.warn(
      "[protocol] append failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/** Fire-and-forget helper for hot paths. */
export function logProtocolEvent(input: ProtocolEventInput): void {
  void appendProtocolEvent(input);
}

/** Project a cloud-quota-log row into a protocol event (deep-link / Kontingent filter). */
function cloudLogToProtocol(e: CloudQuotaLogEntry): ProtocolEvent {
  const label = (e.groupLabel?.trim() || e.label || "Cloud-Anfrage").slice(0, 120);
  const pathShort = (e.path.replace(/^\/api\/v2/, "") || e.path).slice(0, 200);
  return {
    id: `cq-${e.id}`,
    at: e.at,
    dayKey: e.dayKey,
    category: "quota",
    type: "quota.request",
    message:
      e.delta > 1
        ? `Cloud-Request: ${label} (+${e.delta})`
        : `Cloud-Request: ${label}`,
    detail: {
      method: e.method,
      path: pathShort,
      delta: e.delta,
      label: e.label.slice(0, 120),
      groupId: e.groupId ?? null,
      groupLabel: e.groupLabel ?? null,
      source: "cloud-quota-log",
    },
  };
}

function quotaRequestDedupeKey(e: ProtocolEvent): string {
  if (e.type !== "quota.request") {
    return e.id;
  }
  const d = e.detail ?? {};
  return `${e.at}|${String(d.method ?? "")}|${String(d.path ?? "")}|${String(d.delta ?? 1)}`;
}

export async function getProtocolEvents(opts?: {
  category?: ProtocolEventCategory | "all";
  q?: string;
  since?: string;
  until?: string;
  limit?: number;
  todayOnly?: boolean;
}): Promise<ProtocolEventsResponse> {
  const todayOnly = opts?.todayOnly === true;
  const limit = Math.min(
    MAX_LOG_ENTRIES,
    Math.max(1, Math.floor(opts?.limit ?? 100)),
  );
  const dayKey = berlinDayKey();
  const log = await loadLog();
  let entries = log.entries.slice();

  if (todayOnly) {
    entries = entries.filter((e) => e.dayKey === dayKey);
  }

  const category = opts?.category;
  if (category && category !== "all") {
    entries = entries.filter((e) => e.category === category);
  }

  const sinceMs = opts?.since ? Date.parse(opts.since) : NaN;
  if (Number.isFinite(sinceMs)) {
    entries = entries.filter((e) => Date.parse(e.at) >= sinceMs);
  }
  const untilMs = opts?.until ? Date.parse(opts.until) : NaN;
  if (Number.isFinite(untilMs)) {
    entries = entries.filter((e) => Date.parse(e.at) <= untilMs);
  }

  // Integrate existing cloud-quota-log into Kontingent (and Alle) views.
  if (!category || category === "all" || category === "quota") {
    try {
      const cloud = await getCloudQuotaLog({
        todayOnly,
        limit: MAX_LOG_ENTRIES,
      });
      let cloudEntries = cloud.entries.map(cloudLogToProtocol);
      if (Number.isFinite(sinceMs)) {
        cloudEntries = cloudEntries.filter((e) => Date.parse(e.at) >= sinceMs);
      }
      if (Number.isFinite(untilMs)) {
        cloudEntries = cloudEntries.filter((e) => Date.parse(e.at) <= untilMs);
      }
      const seen = new Set(entries.map(quotaRequestDedupeKey));
      for (const row of cloudEntries) {
        const key = quotaRequestDedupeKey(row);
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        entries.push(row);
      }
    } catch (err) {
      console.warn(
        "[protocol] cloud-quota-log merge failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  const q = (opts?.q ?? "").trim().toLowerCase();
  if (q) {
    entries = entries.filter((e) => {
      const hay = [
        e.message,
        e.type,
        e.category,
        e.roomId ?? "",
        e.detail ? JSON.stringify(e.detail) : "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }

  entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  entries = entries.slice(0, limit);

  return {
    entries,
    retained: log.entries.length,
    maxRetained: MAX_LOG_ENTRIES,
    dayKey,
    todayOnly,
    categories: ALL_CATEGORIES,
  };
}

export { ALL_CATEGORIES, ALL_CATEGORIES as PROTOCOL_CATEGORIES, MAX_LOG_ENTRIES };
