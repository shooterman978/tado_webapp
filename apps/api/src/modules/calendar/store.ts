/**
 * Persist CalDAV credentials + calendar rules under BRIDGE_DATA_DIR.
 * App passwords must never be logged, returned via API, or committed.
 *
 * @package @heizplan/api
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  CalendarActiveOverride,
  CalendarApplyPath,
  CalendarInfo,
  CalendarMatchKind,
  CalendarRule,
  CalendarRuleMode,
} from "@heizplan/shared";

const CRED_FILE = "calendar-credentials.json";
const RULES_FILE = "calendar-rules.json";
const ACTIVE_FILE = "calendar-active.json";
const META_FILE = "calendar-meta.json";

export interface CalendarCredentials {
  url: string;
  username: string;
  /** iCloud / CalDAV app-specific password — volume only. */
  appPassword: string;
  updatedAt: string;
}

export interface CalendarMeta {
  lastOkAt: string | null;
  lastError: string | null;
  calendars: CalendarInfo[];
  updatedAt: string;
}

interface RulesFile {
  rules: CalendarRule[];
}

interface ActiveFile {
  overrides: CalendarActiveOverride[];
}

async function ensureDir(dataDir: string): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
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
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
    encoding: "utf8",
  });
  await fs.rename(tmp, file);
}

export async function loadCalendarCredentials(
  dataDir: string,
): Promise<CalendarCredentials | null> {
  const raw = await readJson<Partial<CalendarCredentials>>(
    path.join(dataDir, CRED_FILE),
  );
  if (!raw?.url || !raw.username || !raw.appPassword) {
    return null;
  }
  return {
    url: String(raw.url).replace(/\/+$/, ""),
    username: String(raw.username),
    appPassword: String(raw.appPassword),
    updatedAt: raw.updatedAt ?? new Date().toISOString(),
  };
}

export async function saveCalendarCredentials(
  dataDir: string,
  creds: Omit<CalendarCredentials, "updatedAt">,
): Promise<CalendarCredentials> {
  await ensureDir(dataDir);
  const next: CalendarCredentials = {
    url: creds.url.replace(/\/+$/, ""),
    username: creds.username.trim(),
    appPassword: creds.appPassword,
    updatedAt: new Date().toISOString(),
  };
  await writeJson(path.join(dataDir, CRED_FILE), next);
  return next;
}

export async function clearCalendarCredentials(dataDir: string): Promise<void> {
  try {
    await fs.unlink(path.join(dataDir, CRED_FILE));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }
}

export async function loadCalendarMeta(dataDir: string): Promise<CalendarMeta> {
  const raw = await readJson<Partial<CalendarMeta>>(path.join(dataDir, META_FILE));
  return {
    lastOkAt: raw?.lastOkAt ?? null,
    lastError: raw?.lastError ?? null,
    calendars: Array.isArray(raw?.calendars) ? raw!.calendars! : [],
    updatedAt: raw?.updatedAt ?? new Date(0).toISOString(),
  };
}

export async function saveCalendarMeta(
  dataDir: string,
  meta: Omit<CalendarMeta, "updatedAt">,
): Promise<CalendarMeta> {
  const next: CalendarMeta = {
    ...meta,
    updatedAt: new Date().toISOString(),
  };
  await writeJson(path.join(dataDir, META_FILE), next);
  return next;
}

function normaliseMatchKind(kind: unknown): CalendarMatchKind {
  if (kind === "title_equals" || kind === "title_regex") {
    return kind;
  }
  return "title_contains";
}

function normaliseMode(mode: unknown): CalendarRuleMode {
  if (mode === "off" || mode === "eco") {
    return mode;
  }
  return "heat";
}

function normaliseApplyPath(pathValue: unknown): CalendarApplyPath {
  return pathValue === "cloud_write" ? "cloud_write" : "hap_overlay";
}

export function normaliseRule(
  input: Partial<CalendarRule> & {
    match?: { kind?: string; value?: string };
  },
  existing?: CalendarRule,
): CalendarRule {
  const now = new Date().toISOString();
  const matchValue = (input.match?.value ?? existing?.match.value ?? "").trim();
  if (!matchValue) {
    throw new Error("match.value is required");
  }
  const roomIds = Array.isArray(input.roomIds)
    ? input.roomIds.map(String).filter(Boolean)
    : existing?.roomIds ?? [];
  if (roomIds.length === 0) {
    throw new Error("roomIds must contain at least one room");
  }
  const mode = normaliseMode(input.mode ?? existing?.mode);
  let targetTempC =
    typeof input.targetTempC === "number"
      ? input.targetTempC
      : existing?.targetTempC ?? null;
  if (mode === "off") {
    targetTempC = null;
  } else if (mode === "eco") {
    targetTempC =
      typeof targetTempC === "number" && Number.isFinite(targetTempC)
        ? targetTempC
        : 16;
  } else if (
    typeof targetTempC !== "number" ||
    !Number.isFinite(targetTempC) ||
    targetTempC < 5 ||
    targetTempC > 30
  ) {
    throw new Error("targetTempC must be between 5 and 30 for heat mode");
  }

  return {
    id: existing?.id ?? input.id ?? randomUUID(),
    name: (input.name ?? existing?.name ?? matchValue).trim() || matchValue,
    enabled: typeof input.enabled === "boolean" ? input.enabled : existing?.enabled ?? true,
    calendarId:
      input.calendarId === undefined
        ? existing?.calendarId ?? null
        : input.calendarId
          ? String(input.calendarId)
          : null,
    match: {
      kind: normaliseMatchKind(input.match?.kind ?? existing?.match.kind),
      value: matchValue,
    },
    roomIds,
    mode,
    targetTempC,
    applyPath: normaliseApplyPath(input.applyPath ?? existing?.applyPath),
    priority:
      typeof input.priority === "number" && Number.isFinite(input.priority)
        ? Math.trunc(input.priority)
        : existing?.priority ?? 100,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

export async function loadCalendarRules(dataDir: string): Promise<CalendarRule[]> {
  const file = await readJson<RulesFile>(path.join(dataDir, RULES_FILE));
  if (!file?.rules || !Array.isArray(file.rules)) {
    return [];
  }
  return file.rules.map((r) => normaliseRule(r, r));
}

export async function saveCalendarRules(
  dataDir: string,
  rules: CalendarRule[],
): Promise<CalendarRule[]> {
  await writeJson(path.join(dataDir, RULES_FILE), { rules } satisfies RulesFile);
  return rules;
}

export async function upsertCalendarRule(
  dataDir: string,
  input: Partial<CalendarRule>,
  id?: string,
): Promise<CalendarRule> {
  const rules = await loadCalendarRules(dataDir);
  const existing = id ? rules.find((r) => r.id === id) : undefined;
  if (id && !existing) {
    throw new Error(`Rule not found: ${id}`);
  }
  const next = normaliseRule(input, existing);
  const list = existing
    ? rules.map((r) => (r.id === existing.id ? next : r))
    : [...rules, next];
  await saveCalendarRules(dataDir, list);
  return next;
}

export async function deleteCalendarRule(
  dataDir: string,
  id: string,
): Promise<boolean> {
  const rules = await loadCalendarRules(dataDir);
  const next = rules.filter((r) => r.id !== id);
  if (next.length === rules.length) {
    return false;
  }
  await saveCalendarRules(dataDir, next);
  return true;
}

export async function loadActiveOverrides(
  dataDir: string,
): Promise<CalendarActiveOverride[]> {
  const file = await readJson<ActiveFile>(path.join(dataDir, ACTIVE_FILE));
  return Array.isArray(file?.overrides) ? file!.overrides! : [];
}

export async function saveActiveOverrides(
  dataDir: string,
  overrides: CalendarActiveOverride[],
): Promise<CalendarActiveOverride[]> {
  await writeJson(path.join(dataDir, ACTIVE_FILE), {
    overrides,
  } satisfies ActiveFile);
  return overrides;
}
