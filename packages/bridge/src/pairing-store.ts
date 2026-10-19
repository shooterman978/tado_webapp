/**
 * Persist HomeKit pairing credentials under BRIDGE_DATA_DIR.
 * Never log or commit the contents of this store.
 *
 * @package @heizplan/bridge
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { PairingData } from "hap-controller";

const STORE_FILENAME = "pairing.json";

/** On-disk shape — buffers round-trip via Node Buffer JSON. */
export interface PersistedPairing {
  /** HAP device id used with HttpClient (AccessoryPairingID). */
  deviceId: string;
  /** Bridge IP used when pairing (reconnect hint). */
  address: string;
  /** HAP HTTP port (typically 80). */
  port: number;
  /** Opaque long-term pairing keys from hap-controller. */
  pairingData: PairingData;
  updatedAt: string;
}

function storePath(dataDir: string): string {
  return path.join(dataDir, STORE_FILENAME);
}

function reviveBuffers(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(reviveBuffers);
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (obj.type === "Buffer" && Array.isArray(obj.data)) {
      return Buffer.from(obj.data as number[]);
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = reviveBuffers(v);
    }
    return out;
  }
  return value;
}

export async function ensureDataDir(dataDir: string): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
}

export async function loadPairing(
  dataDir: string,
): Promise<PersistedPairing | null> {
  try {
    const raw = await fs.readFile(storePath(dataDir), "utf8");
    const parsed = reviveBuffers(JSON.parse(raw)) as PersistedPairing;
    if (!parsed?.pairingData || !parsed.deviceId || !parsed.address) {
      return null;
    }
    return parsed;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

export async function savePairing(
  dataDir: string,
  pairing: PersistedPairing,
): Promise<void> {
  await ensureDataDir(dataDir);
  const file = storePath(dataDir);
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(pairing, null, 2), {
    mode: 0o600,
    encoding: "utf8",
  });
  await fs.rename(tmp, file);
}

export async function clearPairing(dataDir: string): Promise<void> {
  try {
    await fs.unlink(storePath(dataDir));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw err;
    }
  }
}
