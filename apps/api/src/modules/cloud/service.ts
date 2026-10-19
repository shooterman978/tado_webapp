/**
 * Cloud metadata orchestration — one-time OAuth + zone-name sync.
 *
 * @package @heizplan/api
 */

import type { CloudAuthPollResult, CloudAuthStart, CloudStatus } from "@heizplan/shared";
import { config } from "../../config.js";
import {
  clearPendingAuth,
  clearCloudTokens,
  loadCloudTokens,
  loadPendingAuth,
  loadZoneMetadata,
  saveCloudTokens,
  savePendingAuth,
  saveZoneMetadata,
  type ZoneMetadata,
} from "./store.js";
import {
  fetchZoneMetadata,
  pollDeviceAuth,
  refreshAccessToken,
  startDeviceAuth,
} from "./client.js";

function dataDir(): string {
  return config.bridgeDataDir;
}

export async function getCloudStatus(): Promise<CloudStatus> {
  const tokens = await loadCloudTokens(dataDir());
  const meta = await loadZoneMetadata(dataDir());
  if (!tokens) {
    return {
      linked: false,
      homeId: meta?.homeId ?? null,
      homeName: meta?.homeName ?? null,
      syncedAt: meta?.syncedAt ?? null,
      deviceCount: meta ? Object.keys(meta.devices).length : 0,
      zoneCount: meta ? new Set(Object.values(meta.devices).map((d) => d.zoneId)).size : 0,
      message:
        "Cloud nicht verknüpft. Einmalig Device-Code-Login für Raumnamen (Steuerung bleibt lokal).",
    };
  }
  const zoneIds = meta
    ? new Set(Object.values(meta.devices).map((d) => d.zoneId))
    : new Set<number>();
  return {
    linked: true,
    homeId: meta?.homeId ?? null,
    homeName: meta?.homeName ?? null,
    syncedAt: meta?.syncedAt ?? null,
    deviceCount: meta ? Object.keys(meta.devices).length : 0,
    zoneCount: zoneIds.size,
    message: meta
      ? `Raumnamen von „${meta.homeName}“ (Stand ${meta.syncedAt}).`
      : "Cloud verknüpft — bitte Metadaten syncen.",
  };
}

export async function beginCloudAuth(): Promise<CloudAuthStart> {
  const { pending, public: pub } = await startDeviceAuth();
  await savePendingAuth(dataDir(), pending);
  return pub;
}

export async function pollCloudAuth(): Promise<CloudAuthPollResult> {
  const pending = await loadPendingAuth(dataDir());
  if (!pending) {
    return {
      status: "error",
      message: "Kein laufender Device-Code-Login. Zuerst POST /api/cloud/auth/start.",
    };
  }
  const outcome = await pollDeviceAuth(pending);
  if (outcome.status === "pending") {
    return {
      status: "pending",
      message: "Warte auf Bestätigung im Browser …",
    };
  }
  if (outcome.status === "expired") {
    await clearPendingAuth(dataDir());
    return {
      status: "expired",
      message: "Device-Code abgelaufen — erneut starten.",
    };
  }
  if (outcome.status === "error") {
    return { status: "error", message: outcome.message };
  }

  await saveCloudTokens(dataDir(), outcome.tokens);
  await clearPendingAuth(dataDir());
  try {
    await syncZoneMetadata();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync nach Login fehlgeschlagen";
    return {
      status: "linked",
      message: `Login ok, Sync fehlgeschlagen: ${message}`,
      cloud: await getCloudStatus(),
    };
  }
  return {
    status: "linked",
    message: "Cloud verknüpft und Raumnamen synchronisiert.",
    cloud: await getCloudStatus(),
  };
}

async function ensureAccessToken(): Promise<string> {
  const tokens = await loadCloudTokens(dataDir());
  if (!tokens) {
    throw new Error("Cloud not linked — start device auth first.");
  }
  if (Date.now() < tokens.expiresAt - 5_000) {
    return tokens.accessToken;
  }
  const next = await refreshAccessToken(tokens.refreshToken);
  await saveCloudTokens(dataDir(), next);
  return next.accessToken;
}

export async function syncZoneMetadata(): Promise<ZoneMetadata> {
  const accessToken = await ensureAccessToken();
  const meta = await fetchZoneMetadata(accessToken);
  await saveZoneMetadata(dataDir(), meta);
  return meta;
}

export async function unlinkCloud(): Promise<void> {
  await clearCloudTokens(dataDir());
  await clearPendingAuth(dataDir());
  // Keep zone-metadata.json so names still work offline until re-sync.
}

export async function getCachedZoneMetadata(): Promise<ZoneMetadata | null> {
  return loadZoneMetadata(dataDir());
}
