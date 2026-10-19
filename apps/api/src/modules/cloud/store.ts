/**
 * Persist Tado cloud OAuth tokens + zone-name metadata under BRIDGE_DATA_DIR.
 * Tokens must never be logged or committed.
 *
 * @package @heizplan/api
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { ZoneSchedule } from "@heizplan/shared";

const TOKEN_FILE = "cloud-tokens.json";
const META_FILE = "zone-metadata.json";
const ROOM_MAP_FILE = "room-map.json";
const PENDING_AUTH_FILE = "cloud-auth-pending.json";
const SCHEDULE_CACHE_FILE = "schedule-cache.json";
const SYNC_STATE_FILE = "cloud-sync-state.json";

export interface CloudTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when access token is considered expired. */
  expiresAt: number;
  updatedAt: string;
}

export interface DeviceZoneMeta {
  zoneId: number;
  zoneName: string;
  serialNo: string;
  shortSerialNo?: string;
  deviceType?: string;
}

export interface ZoneMetadata {
  homeId: number;
  homeName: string;
  syncedAt: string;
  /** serialNo (and shortSerialNo) → zone. */
  devices: Record<string, DeviceZoneMeta>;
}

export interface PendingDeviceAuth {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  interval: number;
  expiresAt: number;
  createdAt: string;
}

/** Manual serial → room name overrides (volume file, not git). */
export type RoomMap = Record<string, string>;

/** Disk cache of Smart Schedules — filled only by explicit sync/write. */
export interface ScheduleCacheFile {
  updatedAt: string;
  schedules: Record<string, ZoneSchedule>;
}

/** Home-level sync bookmark (metadata + openWindow snapshot). */
export interface CloudSyncState {
  lastSyncedAt: string | null;
  openWindowByZoneId: Record<number, boolean>;
  openWindowSyncedAt: string | null;
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
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), {
    mode: 0o600,
    encoding: "utf8",
  });
  await fs.rename(tmp, file);
}

export async function loadCloudTokens(
  dataDir: string,
): Promise<CloudTokens | null> {
  return readJson<CloudTokens>(path.join(dataDir, TOKEN_FILE));
}

export async function saveCloudTokens(
  dataDir: string,
  tokens: CloudTokens,
): Promise<void> {
  await ensureDir(dataDir);
  await writeJson(path.join(dataDir, TOKEN_FILE), tokens);
}

export async function clearCloudTokens(dataDir: string): Promise<void> {
  try {
    await fs.unlink(path.join(dataDir, TOKEN_FILE));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }
}

export async function loadZoneMetadata(
  dataDir: string,
): Promise<ZoneMetadata | null> {
  return readJson<ZoneMetadata>(path.join(dataDir, META_FILE));
}

export async function saveZoneMetadata(
  dataDir: string,
  meta: ZoneMetadata,
): Promise<void> {
  await ensureDir(dataDir);
  await writeJson(path.join(dataDir, META_FILE), meta);
}

export async function loadRoomMap(dataDir: string): Promise<RoomMap> {
  const map = await readJson<RoomMap>(path.join(dataDir, ROOM_MAP_FILE));
  return map ?? {};
}

export async function loadPendingAuth(
  dataDir: string,
): Promise<PendingDeviceAuth | null> {
  return readJson<PendingDeviceAuth>(path.join(dataDir, PENDING_AUTH_FILE));
}

export async function savePendingAuth(
  dataDir: string,
  pending: PendingDeviceAuth,
): Promise<void> {
  await ensureDir(dataDir);
  await writeJson(path.join(dataDir, PENDING_AUTH_FILE), pending);
}

export async function clearPendingAuth(dataDir: string): Promise<void> {
  try {
    await fs.unlink(path.join(dataDir, PENDING_AUTH_FILE));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }
}

export async function loadScheduleCache(
  dataDir: string,
): Promise<ScheduleCacheFile> {
  const file = await readJson<ScheduleCacheFile>(
    path.join(dataDir, SCHEDULE_CACHE_FILE),
  );
  return file ?? { updatedAt: new Date(0).toISOString(), schedules: {} };
}

export async function saveScheduleCacheEntry(
  dataDir: string,
  roomId: string,
  schedule: ZoneSchedule,
): Promise<void> {
  await ensureDir(dataDir);
  const cache = await loadScheduleCache(dataDir);
  cache.schedules[roomId] = schedule;
  cache.updatedAt = new Date().toISOString();
  await writeJson(path.join(dataDir, SCHEDULE_CACHE_FILE), cache);
}

export async function loadCloudSyncState(
  dataDir: string,
): Promise<CloudSyncState> {
  const file = await readJson<CloudSyncState>(
    path.join(dataDir, SYNC_STATE_FILE),
  );
  return (
    file ?? {
      lastSyncedAt: null,
      openWindowByZoneId: {},
      openWindowSyncedAt: null,
    }
  );
}

export async function saveCloudSyncState(
  dataDir: string,
  state: CloudSyncState,
): Promise<void> {
  await ensureDir(dataDir);
  await writeJson(path.join(dataDir, SYNC_STATE_FILE), state);
}
