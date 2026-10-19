/**
 * Per-room learned Model 0 / Model 3 state under BRIDGE_DATA_DIR/heatup/.
 *
 * @package @heizplan/api
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { RoomModelState } from "./predict.js";
import { emptyRoomModelState } from "./predict.js";

const MODELS_FILE = "models.json";

type ModelsFile = { rooms: Record<string, RoomModelState> };

let cache: Record<string, RoomModelState> | null = null;

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

export async function loadAllModels(
  dataDir: string,
): Promise<Record<string, RoomModelState>> {
  if (cache) {
    return cache;
  }
  const file = await readJson<ModelsFile>(
    path.join(dataDir, "heatup", MODELS_FILE),
    { rooms: {} },
  );
  cache = file.rooms && typeof file.rooms === "object" ? file.rooms : {};
  return cache;
}

export async function getRoomModel(
  dataDir: string,
  roomId: string,
  offsetMin: number,
): Promise<RoomModelState> {
  const all = await loadAllModels(dataDir);
  return all[roomId] ?? emptyRoomModelState(roomId, offsetMin);
}

export async function saveRoomModel(
  dataDir: string,
  state: RoomModelState,
): Promise<RoomModelState> {
  const all = await loadAllModels(dataDir);
  all[state.roomId] = state;
  await writeJson(path.join(dataDir, "heatup", MODELS_FILE), { rooms: all });
  cache = all;
  return state;
}

export function resetModelStoreCache(): void {
  cache = null;
}
