/**
 * Open-window settings, manual overrides, and auto-off resume snapshots.
 * Persisted under BRIDGE_DATA_DIR (volume) — no secrets.
 *
 * Resume default: restore previous setpoint when the window closes.
 *
 * @package @heizplan/api
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  OpenWindowResumeMode,
  OpenWindowSettings,
  WindowOpenSource,
} from "@heizplan/shared";

const SETTINGS_FILE = "open-window-settings.json";
const OVERRIDES_FILE = "open-window-overrides.json";
const SNAPSHOTS_FILE = "open-window-snapshots.json";

export interface WindowOverride {
  open: boolean;
  updatedAt: string;
  source: "manual" | "fixture";
}

export interface AutoOffSnapshot {
  zoneId: string;
  previousTargetTempC: number | null;
  previousMode: "heat" | "off";
  triggeredAt: string;
}

const DEFAULT_SETTINGS: OpenWindowSettings = {
  detectionEnabled: true,
  globalAutoOff: false,
  resumeMode: "restore_setpoint",
  rooms: {},
};

let settingsCache: OpenWindowSettings | null = null;
let overridesCache: Record<string, WindowOverride> | null = null;
let snapshotsCache: Record<string, AutoOffSnapshot> | null = null;
/** First-seen timestamps for open windows (in-memory). */
const detectedAt = new Map<string, string>();

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function loadOpenWindowSettings(
  dataDir: string,
): Promise<OpenWindowSettings> {
  if (settingsCache) {
    return settingsCache;
  }
  const loaded = await readJson<Partial<OpenWindowSettings>>(
    path.join(dataDir, SETTINGS_FILE),
    {},
  );
  settingsCache = {
    // Missing key → enabled (legacy files pre-date this flag).
    detectionEnabled: loaded.detectionEnabled !== false,
    globalAutoOff: Boolean(loaded.globalAutoOff),
    resumeMode:
      loaded.resumeMode === "clear_overlay"
        ? "clear_overlay"
        : "restore_setpoint",
    rooms: loaded.rooms && typeof loaded.rooms === "object" ? loaded.rooms : {},
  };
  return settingsCache;
}

export async function saveOpenWindowSettings(
  dataDir: string,
  next: OpenWindowSettings,
): Promise<OpenWindowSettings> {
  const normalised: OpenWindowSettings = {
    detectionEnabled: next.detectionEnabled !== false,
    globalAutoOff: Boolean(next.globalAutoOff),
    resumeMode:
      next.resumeMode === "clear_overlay"
        ? "clear_overlay"
        : ("restore_setpoint" as OpenWindowResumeMode),
    rooms: next.rooms ?? {},
  };
  await writeJson(path.join(dataDir, SETTINGS_FILE), normalised);
  settingsCache = normalised;
  return normalised;
}

export async function loadWindowOverrides(
  dataDir: string,
): Promise<Record<string, WindowOverride>> {
  if (overridesCache) {
    return overridesCache;
  }
  overridesCache = await readJson(path.join(dataDir, OVERRIDES_FILE), {});
  return overridesCache;
}

export async function setWindowOverride(
  dataDir: string,
  zoneId: string,
  open: boolean,
  source: "manual" | "fixture" = "manual",
): Promise<WindowOverride> {
  const all = await loadWindowOverrides(dataDir);
  const record: WindowOverride = {
    open,
    updatedAt: new Date().toISOString(),
    source,
  };
  all[zoneId] = record;
  await writeJson(path.join(dataDir, OVERRIDES_FILE), all);
  overridesCache = all;
  if (open) {
    detectedAt.set(zoneId, record.updatedAt);
  } else {
    detectedAt.delete(zoneId);
  }
  return record;
}

export async function clearWindowOverride(
  dataDir: string,
  zoneId: string,
): Promise<void> {
  const all = await loadWindowOverrides(dataDir);
  delete all[zoneId];
  await writeJson(path.join(dataDir, OVERRIDES_FILE), all);
  overridesCache = all;
}

async function loadSnapshots(
  dataDir: string,
): Promise<Record<string, AutoOffSnapshot>> {
  if (snapshotsCache) {
    return snapshotsCache;
  }
  snapshotsCache = await readJson(path.join(dataDir, SNAPSHOTS_FILE), {});
  return snapshotsCache;
}

export async function getAutoOffSnapshot(
  dataDir: string,
  zoneId: string,
): Promise<AutoOffSnapshot | null> {
  const all = await loadSnapshots(dataDir);
  return all[zoneId] ?? null;
}

export async function setAutoOffSnapshot(
  dataDir: string,
  snapshot: AutoOffSnapshot,
): Promise<void> {
  const all = await loadSnapshots(dataDir);
  all[snapshot.zoneId] = snapshot;
  await writeJson(path.join(dataDir, SNAPSHOTS_FILE), all);
  snapshotsCache = all;
}

export async function clearAutoOffSnapshot(
  dataDir: string,
  zoneId: string,
): Promise<void> {
  const all = await loadSnapshots(dataDir);
  delete all[zoneId];
  await writeJson(path.join(dataDir, SNAPSHOTS_FILE), all);
  snapshotsCache = all;
}

/** Whether auto-off is enabled for a room (room override or global). */
export function isAutoOffEnabled(
  settings: OpenWindowSettings,
  zoneId: string,
): boolean {
  if (settings.detectionEnabled === false) {
    return false;
  }
  const room = settings.rooms[zoneId];
  if (room && typeof room.autoOff === "boolean") {
    return room.autoOff;
  }
  return settings.globalAutoOff;
}

export function touchWindowDetectedAt(
  zoneId: string,
  open: boolean,
): string | null {
  if (!open) {
    detectedAt.delete(zoneId);
    return null;
  }
  const existing = detectedAt.get(zoneId);
  if (existing) {
    return existing;
  }
  const now = new Date().toISOString();
  detectedAt.set(zoneId, now);
  return now;
}

export type ResolvedWindow = {
  windowOpen: boolean;
  windowSource: WindowOpenSource;
  windowDetectedAt: string | null;
};
