/**
 * Central CloudQuota — counts every Tado cloud HTTP call for the Berlin day.
 * Blocks further cloud traffic when the daily limit is reached.
 * Persists a ring-buffer audit log of what counted (no tokens).
 *
 * @package @heizplan/api
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  CloudQuotaLogEntry,
  CloudQuotaLogResponse,
  CloudQuotaStatus,
} from "@heizplan/shared";
import { config } from "../../config.js";
import { noteCloudRequest, noteQuotaStatus } from "../protocol/trackers.js";

const QUOTA_FILE = "cloud-quota.json";
const LOG_FILE = "cloud-quota-log.json";
const TZ = "Europe/Berlin";
const MAX_LOG_ENTRIES = 150;

/** Conservative default for ~100 free-tier calls/day without Auto-Assist. */
export const DEFAULT_CLOUD_DAILY_LIMIT = 80;

export class CloudQuotaExceededError extends Error {
  readonly status: CloudQuotaStatus;

  constructor(status: CloudQuotaStatus) {
    super(
      `Cloud-Tageslimit erreicht (${status.used}/${status.limit}). Reset um Mitternacht Europe/Berlin (${status.resetsAt}).`,
    );
    this.name = "CloudQuotaExceededError";
    this.status = status;
  }
}

interface QuotaFile {
  dayKey: string;
  used: number;
  limit: number;
  headerLimitHint: number | null;
  updatedAt: string;
}

interface LogFile {
  entries: CloudQuotaLogEntry[];
  updatedAt: string;
}

export interface CloudQuotaConsumeMeta {
  method?: string;
  path?: string;
  label?: string;
  groupId?: string | null;
  groupLabel?: string | null;
}

interface CloudGroupContext {
  groupId: string;
  groupLabel: string;
}

const cloudGroupStore = new AsyncLocalStorage<CloudGroupContext>();

function dataDir(): string {
  return config.bridgeDataDir;
}

/** Calendar day YYYY-MM-DD in Europe/Berlin. */
export function berlinDayKey(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Next midnight Europe/Berlin as ISO string. */
export function nextBerlinMidnightIso(now = new Date()): string {
  const dayKey = berlinDayKey(now);
  let lo = now.getTime();
  let hi = lo + 36 * 3_600_000; // covers DST transitions
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2);
    if (berlinDayKey(new Date(mid)) === dayKey) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  while (berlinDayKey(new Date(hi)) === dayKey) {
    hi += 1000;
  }
  return new Date(hi).toISOString();
}

function toStatus(file: QuotaFile): CloudQuotaStatus {
  const used = Math.max(0, file.used);
  const limit = Math.max(1, file.limit);
  const remaining = Math.max(0, limit - used);
  const warnAt = Math.max(5, Math.ceil(limit * 0.1));
  return {
    used,
    limit,
    remaining,
    resetsAt: nextBerlinMidnightIso(),
    dayKey: file.dayKey,
    nearLimit: remaining > 0 && remaining <= warnAt,
    blocked: remaining === 0,
    headerLimitHint: file.headerLimitHint,
  };
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

function defaultLimit(): number {
  return config.cloudDailyLimit;
}

async function loadOrReset(): Promise<QuotaFile> {
  const today = berlinDayKey();
  const existing = await readJson<QuotaFile>(path.join(dataDir(), QUOTA_FILE));
  if (!existing || existing.dayKey !== today) {
    const next: QuotaFile = {
      dayKey: today,
      used: 0,
      limit: existing?.limit && existing.limit > 0 ? existing.limit : defaultLimit(),
      headerLimitHint: existing?.headerLimitHint ?? null,
      updatedAt: new Date().toISOString(),
    };
    await writeJson(path.join(dataDir(), QUOTA_FILE), next);
    return next;
  }
  return existing;
}

async function loadLog(): Promise<LogFile> {
  const existing = await readJson<LogFile>(path.join(dataDir(), LOG_FILE));
  if (!existing || !Array.isArray(existing.entries)) {
    return { entries: [], updatedAt: new Date().toISOString() };
  }
  return existing;
}

async function appendLogEntry(entry: CloudQuotaLogEntry): Promise<void> {
  const log = await loadLog();
  log.entries.push(entry);
  if (log.entries.length > MAX_LOG_ENTRIES) {
    log.entries = log.entries.slice(-MAX_LOG_ENTRIES);
  }
  log.updatedAt = new Date().toISOString();
  await writeJson(path.join(dataDir(), LOG_FILE), log);
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Run several cloud HTTP calls under one group id (e.g. schedule sync = 3 GETs).
 * Nested groups keep the outer group.
 */
export function runCloudRequestGroup<T>(
  groupLabel: string,
  fn: () => Promise<T>,
): Promise<T> {
  const existing = cloudGroupStore.getStore();
  if (existing) {
    return fn();
  }
  const groupId = `g-${newId()}`;
  return cloudGroupStore.run({ groupId, groupLabel }, fn);
}

export function currentCloudGroup(): CloudGroupContext | null {
  return cloudGroupStore.getStore() ?? null;
}

/** Current quota snapshot (resets automatically on Berlin day change). */
export async function getCloudQuota(): Promise<CloudQuotaStatus> {
  const file = await loadOrReset();
  return toStatus(file);
}

/** Update the configurable daily limit (persists across day resets). */
export async function setCloudQuotaLimit(limit: number): Promise<CloudQuotaStatus> {
  const n = Math.floor(limit);
  if (!Number.isFinite(n) || n < 1 || n > 10_000) {
    throw new Error("limit must be an integer between 1 and 10000");
  }
  const file = await loadOrReset();
  file.limit = n;
  file.updatedAt = new Date().toISOString();
  await writeJson(path.join(dataDir(), QUOTA_FILE), file);
  return toStatus(file);
}

/**
 * Reserve `count` cloud requests and append audit log entries.
 * Throws {@link CloudQuotaExceededError} when blocked.
 */
export async function consumeCloudQuota(
  count = 1,
  meta: CloudQuotaConsumeMeta = {},
): Promise<CloudQuotaStatus> {
  const n = Math.max(1, Math.floor(count));
  const file = await loadOrReset();
  if (file.used + n > file.limit) {
    const blocked = toStatus(file);
    noteQuotaStatus({ ...blocked, blocked: true, remaining: 0, nearLimit: true });
    throw new CloudQuotaExceededError(blocked);
  }
  file.used += n;
  file.updatedAt = new Date().toISOString();
  await writeJson(path.join(dataDir(), QUOTA_FILE), file);

  const group = currentCloudGroup();
  const now = new Date();
  const entry: CloudQuotaLogEntry = {
    id: newId(),
    at: now.toISOString(),
    dayKey: file.dayKey,
    method: (meta.method ?? "GET").toUpperCase(),
    path: meta.path ?? "/",
    label: meta.label ?? "cloud.request",
    delta: n,
    groupId: meta.groupId ?? group?.groupId ?? null,
    groupLabel: meta.groupLabel ?? group?.groupLabel ?? null,
  };
  try {
    await appendLogEntry(entry);
  } catch (err) {
    console.warn(
      "[cloud-quota] log append failed:",
      err instanceof Error ? err.message : err,
    );
  }
  const status = toStatus(file);
  noteCloudRequest({
    method: entry.method,
    path: entry.path,
    label: entry.label,
    delta: entry.delta,
    groupId: entry.groupId,
    groupLabel: entry.groupLabel,
    used: status.used,
    limit: status.limit,
  });
  noteQuotaStatus(status);
  return status;
}

/**
 * Soft check — does not consume. Useful before optional background polls.
 */
export async function canAffordCloudRequest(count = 1): Promise<boolean> {
  const status = await getCloudQuota();
  return status.remaining >= count;
}

/**
 * Ring-buffer log of counted cloud HTTP calls (newest last in file; returned newest first).
 */
export async function getCloudQuotaLog(opts?: {
  todayOnly?: boolean;
  limit?: number;
}): Promise<CloudQuotaLogResponse> {
  const todayOnly = opts?.todayOnly !== false;
  const limit = Math.min(
    MAX_LOG_ENTRIES,
    Math.max(1, Math.floor(opts?.limit ?? MAX_LOG_ENTRIES)),
  );
  const dayKey = berlinDayKey();
  const log = await loadLog();
  let entries = log.entries.slice();
  if (todayOnly) {
    entries = entries.filter((e) => e.dayKey === dayKey);
  }
  entries.reverse();
  entries = entries.slice(0, limit);
  return {
    entries,
    retained: log.entries.length,
    maxRetained: MAX_LOG_ENTRIES,
    todayOnly,
    dayKey,
  };
}

/**
 * Optionally adopt a daily limit hint from response headers
 * (X-RateLimit-Limit / RateLimit-Limit) when present.
 */
export async function noteCloudRateLimitHeaders(
  headers: Headers,
): Promise<void> {
  const raw =
    headers.get("x-ratelimit-limit") ??
    headers.get("ratelimit-limit") ??
    headers.get("X-RateLimit-Limit");
  if (!raw) {
    return;
  }
  const match = raw.match(/(\d+)/);
  if (!match) {
    return;
  }
  const hint = Number(match[1]);
  if (!Number.isFinite(hint) || hint < 1) {
    return;
  }
  const file = await loadOrReset();
  file.headerLimitHint = hint;
  if (file.limit === DEFAULT_CLOUD_DAILY_LIMIT && hint < file.limit) {
    file.limit = hint;
  }
  file.updatedAt = new Date().toISOString();
  await writeJson(path.join(dataDir(), QUOTA_FILE), file);
}
