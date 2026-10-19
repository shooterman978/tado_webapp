/**
 * Central CloudQuota — counts every Tado cloud HTTP call for the Berlin day.
 * Blocks further cloud traffic when the daily limit is reached.
 *
 * @package @heizplan/api
 */

import type { CloudQuotaStatus } from "@heizplan/shared";
import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "../../config.js";

const QUOTA_FILE = "cloud-quota.json";
const TZ = "Europe/Berlin";

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

async function readFile(): Promise<QuotaFile | null> {
  const file = path.join(dataDir(), QUOTA_FILE);
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as QuotaFile;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

async function writeFile(value: QuotaFile): Promise<void> {
  const dir = dataDir();
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, QUOTA_FILE);
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
  const existing = await readFile();
  if (!existing || existing.dayKey !== today) {
    const next: QuotaFile = {
      dayKey: today,
      used: 0,
      limit: existing?.limit && existing.limit > 0 ? existing.limit : defaultLimit(),
      headerLimitHint: existing?.headerLimitHint ?? null,
      updatedAt: new Date().toISOString(),
    };
    await writeFile(next);
    return next;
  }
  return existing;
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
  await writeFile(file);
  return toStatus(file);
}

/**
 * Reserve `count` cloud requests. Throws {@link CloudQuotaExceededError} when blocked.
 * Call once per outbound HTTP request to Tado cloud.
 */
export async function consumeCloudQuota(count = 1): Promise<CloudQuotaStatus> {
  const n = Math.max(1, Math.floor(count));
  const file = await loadOrReset();
  if (file.used + n > file.limit) {
    throw new CloudQuotaExceededError(toStatus(file));
  }
  file.used += n;
  file.updatedAt = new Date().toISOString();
  await writeFile(file);
  return toStatus(file);
}

/**
 * Soft check — does not consume. Useful before optional background polls.
 */
export async function canAffordCloudRequest(count = 1): Promise<boolean> {
  const status = await getCloudQuota();
  return status.remaining >= count;
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
  // Some APIs send "80" or "80;w=86400" — take the first integer.
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
  // Only auto-adopt when still on the conservative default (never raise above hint).
  if (file.limit === DEFAULT_CLOUD_DAILY_LIMIT && hint < file.limit) {
    file.limit = hint;
  }
  file.updatedAt = new Date().toISOString();
  await writeFile(file);
}
