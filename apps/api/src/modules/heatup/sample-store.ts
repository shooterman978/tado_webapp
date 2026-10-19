/**
 * Persist heat-up samples and active sessions under BRIDGE_DATA_DIR/heatup/.
 *
 * @package @heizplan/api
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  HeatupRejectReason,
  HeatupSample,
  HeatupSampleQuality,
} from "@heizplan/shared";

const SAMPLES_FILE = "samples.json";
const SESSIONS_FILE = "sessions.json";

export interface ActiveHeatupSession {
  roomId: string;
  startedAt: string;
  startTempC: number;
  targetTempC: number;
  outdoorTempC: number | null;
  lastCurrentTempC: number;
  lastProgressAt: string;
  windowOpenSeen: boolean;
}

type SamplesFile = { samples: HeatupSample[] };
type SessionsFile = { sessions: Record<string, ActiveHeatupSession> };

let samplesCache: HeatupSample[] | null = null;
let sessionsCache: Record<string, ActiveHeatupSession> | null = null;

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

function heatupDir(dataDir: string): string {
  return path.join(dataDir, "heatup");
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

export async function loadSamples(dataDir: string): Promise<HeatupSample[]> {
  if (samplesCache) {
    return samplesCache;
  }
  const file = await readJson<SamplesFile>(
    path.join(heatupDir(dataDir), SAMPLES_FILE),
    { samples: [] },
  );
  samplesCache = Array.isArray(file.samples) ? file.samples : [];
  return samplesCache;
}

export async function saveSamples(
  dataDir: string,
  samples: HeatupSample[],
): Promise<void> {
  await writeJson(path.join(heatupDir(dataDir), SAMPLES_FILE), { samples });
  samplesCache = samples;
}

export async function appendSample(
  dataDir: string,
  sample: Omit<HeatupSample, "id"> & { id?: string },
): Promise<HeatupSample> {
  const all = await loadSamples(dataDir);
  const full: HeatupSample = {
    ...sample,
    id: sample.id ?? randomUUID(),
  };
  all.push(full);
  await saveSamples(dataDir, all);
  return full;
}

export async function listSamplesForRoom(
  dataDir: string,
  roomId: string,
): Promise<HeatupSample[]> {
  const all = await loadSamples(dataDir);
  return all.filter((s) => s.roomId === roomId);
}

export async function loadSessions(
  dataDir: string,
): Promise<Record<string, ActiveHeatupSession>> {
  if (sessionsCache) {
    return sessionsCache;
  }
  const file = await readJson<SessionsFile>(
    path.join(heatupDir(dataDir), SESSIONS_FILE),
    { sessions: {} },
  );
  sessionsCache = file.sessions && typeof file.sessions === "object"
    ? file.sessions
    : {};
  return sessionsCache;
}

export async function setSession(
  dataDir: string,
  session: ActiveHeatupSession,
): Promise<void> {
  const all = await loadSessions(dataDir);
  all[session.roomId] = session;
  await writeJson(path.join(heatupDir(dataDir), SESSIONS_FILE), {
    sessions: all,
  });
  sessionsCache = all;
}

export async function clearSession(
  dataDir: string,
  roomId: string,
): Promise<void> {
  const all = await loadSessions(dataDir);
  delete all[roomId];
  await writeJson(path.join(heatupDir(dataDir), SESSIONS_FILE), {
    sessions: all,
  });
  sessionsCache = all;
}

export async function getSession(
  dataDir: string,
  roomId: string,
): Promise<ActiveHeatupSession | null> {
  const all = await loadSessions(dataDir);
  return all[roomId] ?? null;
}

/** Test / seed helper — replace all samples. */
export async function replaceSamples(
  dataDir: string,
  samples: HeatupSample[],
): Promise<void> {
  await saveSamples(dataDir, samples);
}

export function resetHeatupStoreCaches(): void {
  samplesCache = null;
  sessionsCache = null;
}

export function buildSample(input: {
  roomId: string;
  startedAt: string;
  endedAt: string;
  startTempC: number;
  targetTempC: number;
  outdoorTempC: number | null;
  durationMinutes: number;
  quality: HeatupSampleQuality;
  rejectReason?: HeatupRejectReason | null;
  id?: string;
}): HeatupSample {
  return {
    id: input.id ?? randomUUID(),
    roomId: input.roomId,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    startTempC: input.startTempC,
    targetTempC: input.targetTempC,
    deltaTC: Number((input.targetTempC - input.startTempC).toFixed(2)),
    outdoorTempC: input.outdoorTempC,
    durationMinutes: input.durationMinutes,
    quality: input.quality,
    rejectReason: input.rejectReason ?? null,
  };
}
