/**
 * Cloud metadata orchestration — OAuth + sparse home sync (not per room-enter).
 *
 * @package @heizplan/api
 */

import type {
  CloudAuthPollResult,
  CloudAuthStart,
  CloudStatus,
  CloudSyncStatus,
} from "@heizplan/shared";
import { config } from "../../config.js";
import {
  clearPendingAuth,
  clearCloudTokens,
  loadCloudSyncState,
  loadCloudTokens,
  loadPendingAuth,
  loadZoneMetadata,
  saveCloudSyncState,
  saveCloudTokens,
  savePendingAuth,
  saveZoneMetadata,
  type ZoneMetadata,
} from "./store.js";
import {
  fetchOpenWindowByZoneId,
  fetchZoneMetadata,
  pollDeviceAuth,
  refreshAccessToken,
  startDeviceAuth,
} from "./client.js";
import { logProtocolEvent } from "../protocol/event-log.js";
import { getCloudQuota, runCloudRequestGroup } from "./quota.js";
import { listScheduleCacheTimes } from "./schedule-service.js";

function dataDir(): string {
  return config.bridgeDataDir;
}

function autoSyncHours(): number {
  const n = config.cloudAutoSyncHours;
  return Number.isFinite(n) && n >= 0.25 ? n : 4;
}

function isAutoSyncDue(lastSyncedAt: string | null): boolean {
  if (!lastSyncedAt) {
    return true;
  }
  const ageMs = Date.now() - Date.parse(lastSyncedAt);
  if (!Number.isFinite(ageMs)) {
    return true;
  }
  return ageMs >= autoSyncHours() * 3_600_000;
}

export async function getCloudStatus(): Promise<CloudStatus> {
  const tokens = await loadCloudTokens(dataDir());
  const meta = await loadZoneMetadata(dataDir());
  const sync = await loadCloudSyncState(dataDir());
  if (!tokens) {
    return {
      linked: false,
      homeId: meta?.homeId ?? null,
      homeName: meta?.homeName ?? null,
      syncedAt: sync.lastSyncedAt ?? meta?.syncedAt ?? null,
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
    syncedAt: sync.lastSyncedAt ?? meta?.syncedAt ?? null,
    deviceCount: meta ? Object.keys(meta.devices).length : 0,
    zoneCount: zoneIds.size,
    message: meta
      ? `Raumnamen von „${meta.homeName}“ (Stand ${sync.lastSyncedAt ?? meta.syncedAt}).`
      : "Cloud verknüpft — bitte Metadaten syncen.",
  };
}

export async function getCloudSyncStatus(): Promise<CloudSyncStatus> {
  const tokens = await loadCloudTokens(dataDir());
  const meta = await loadZoneMetadata(dataDir());
  const sync = await loadCloudSyncState(dataDir());
  const lastSyncedAt = sync.lastSyncedAt ?? meta?.syncedAt ?? null;
  return {
    linked: Boolean(tokens),
    lastSyncedAt,
    autoSyncHours: autoSyncHours(),
    autoSyncDue: Boolean(tokens) && isAutoSyncDue(lastSyncedAt),
    homeName: meta?.homeName ?? null,
    scheduleSyncedAt: await listScheduleCacheTimes(),
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
    await runHomeCloudSync();
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

/**
 * Explicit home cloud sync: zone names + openWindow snapshot.
 * Does **not** pull every room schedule (those are per-room button syncs).
 */
export async function runHomeCloudSync(): Promise<{
  syncedAt: string;
  meta: ZoneMetadata;
  openWindowCount: number;
  quota: Awaited<ReturnType<typeof getCloudQuota>>;
  sync: CloudSyncStatus;
}> {
  return runCloudRequestGroup("Home Cloud-Sync", async () => {
    const meta = await syncZoneMetadata();
    let openWindowByZoneId: Record<number, boolean> = {};
    try {
      const accessToken = await ensureAccessToken();
      openWindowByZoneId = await fetchOpenWindowByZoneId(
        accessToken,
        meta.homeId,
      );
    } catch (err) {
      console.warn(
        "[cloud] openWindow during home sync failed:",
        err instanceof Error ? err.message : err,
      );
      const prev = await loadCloudSyncState(dataDir());
      openWindowByZoneId = prev.openWindowByZoneId;
    }
    const syncedAt = new Date().toISOString();
    await saveCloudSyncState(dataDir(), {
      lastSyncedAt: syncedAt,
      openWindowByZoneId,
      openWindowSyncedAt: syncedAt,
    });
    const openWindowCount = Object.values(openWindowByZoneId).filter(
      Boolean,
    ).length;
    logProtocolEvent({
      category: "schedule",
      type: "schedule.home_sync",
      message: "Home Cloud-Sync abgeschlossen",
      detail: {
        openWindowCount,
        homeName: meta.homeName ?? null,
        deviceCount: Object.keys(meta.devices ?? {}).length,
      },
    });
    return {
      syncedAt,
      meta,
      openWindowCount,
      quota: await getCloudQuota(),
      sync: await getCloudSyncStatus(),
    };
  });
}

export async function unlinkCloud(): Promise<void> {
  await clearCloudTokens(dataDir());
  await clearPendingAuth(dataDir());
  // Keep zone-metadata.json / schedule cache so names still work offline.
}

export async function getCachedZoneMetadata(): Promise<ZoneMetadata | null> {
  return loadZoneMetadata(dataDir());
}

/**
 * Open-window map from last home sync only — **never** hits the network here.
 * Refresh via {@link runHomeCloudSync} (manual button or 4h auto).
 */
export async function getCloudOpenWindowByZoneId(): Promise<
  Record<number, boolean>
> {
  const state = await loadCloudSyncState(dataDir());
  return state.openWindowByZoneId ?? {};
}
