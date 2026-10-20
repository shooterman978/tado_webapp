/**
 * Sparse Tado Home/Away (presence) — cache-first, quota-aware.
 *
 * Source: GET /api/v2/homes/{homeId}/state (presence + presenceLocked).
 * Never polled on every zones list — only when cache is stale or force=true.
 *
 * @package @heizplan/api
 */

import type { CloudQuotaStatus, HomePresenceStatus } from "@heizplan/shared";
import { config } from "../../config.js";
import { fetchHomeState, refreshAccessToken } from "./client.js";
import { CloudQuotaExceededError, getCloudQuota } from "./quota.js";
import {
  loadCloudTokens,
  loadPresenceCache,
  loadZoneMetadata,
  saveCloudTokens,
  savePresenceCache,
} from "./store.js";

function dataDir(): string {
  return config.bridgeDataDir;
}

function ttlMinutes(): number {
  const n = config.cloudPresencePollMinutes;
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : 15;
}

function isFresh(fetchedAt: string): boolean {
  const ageMs = Date.now() - Date.parse(fetchedAt);
  if (!Number.isFinite(ageMs) || ageMs < 0) {
    return false;
  }
  return ageMs < ttlMinutes() * 60_000;
}

function unknownStatus(message: string): HomePresenceStatus {
  return {
    mode: "unknown",
    source: "none",
    presenceLocked: null,
    fetchedAt: null,
    stale: true,
    ttlMinutes: ttlMinutes(),
    message,
  };
}

function fromCache(
  mode: "home" | "away",
  presenceLocked: boolean | null,
  fetchedAt: string,
  fresh: boolean,
): HomePresenceStatus {
  const label = mode === "home" ? "Zuhause" : "Unterwegs";
  return {
    mode,
    source: "cache",
    presenceLocked,
    fetchedAt,
    stale: !fresh,
    ttlMinutes: ttlMinutes(),
    message: fresh
      ? `Aktuell: ${label}`
      : `Zuletzt: ${label} (älter als ${ttlMinutes()} Min.)`,
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

/**
 * Disk-only presence — never hits the network.
 * Used by zones list and calendar status overview.
 */
export async function getCachedHomePresence(): Promise<HomePresenceStatus> {
  const tokens = await loadCloudTokens(dataDir());
  if (!tokens) {
    return unknownStatus(
      "Cloud nicht verknüpft — Home/Away kommt von der Tado-Cloud.",
    );
  }
  const cache = await loadPresenceCache(dataDir());
  if (!cache) {
    return unknownStatus(
      "Noch kein Home/Away-Stand — einmal „Aktualisieren“ oder Kalender prüfen.",
    );
  }
  return fromCache(
    cache.mode,
    cache.presenceLocked,
    cache.fetchedAt,
    isFresh(cache.fetchedAt),
  );
}

/**
 * Cache-first presence. Fetches from cloud only when stale or force=true.
 * Counts 1 CloudQuota unit on a real fetch.
 */
export async function getHomePresence(opts?: {
  force?: boolean;
}): Promise<{
  presence: HomePresenceStatus;
  quota: CloudQuotaStatus;
  fetched: boolean;
}> {
  const force = Boolean(opts?.force);
  const tokens = await loadCloudTokens(dataDir());
  if (!tokens) {
    return {
      presence: unknownStatus(
        "Cloud nicht verknüpft — Home/Away kommt von der Tado-Cloud.",
      ),
      quota: await getCloudQuota(),
      fetched: false,
    };
  }

  const cache = await loadPresenceCache(dataDir());
  if (!force && cache && isFresh(cache.fetchedAt)) {
    return {
      presence: fromCache(
        cache.mode,
        cache.presenceLocked,
        cache.fetchedAt,
        true,
      ),
      quota: await getCloudQuota(),
      fetched: false,
    };
  }

  try {
    const meta = await loadZoneMetadata(dataDir());
    if (!meta?.homeId) {
      return {
        presence: unknownStatus(
          "Keine Home-ID — zuerst Cloud-Metadaten syncen.",
        ),
        quota: await getCloudQuota(),
        fetched: false,
      };
    }
    const accessToken = await ensureAccessToken();
    const state = await fetchHomeState(accessToken, meta.homeId);
    const mode = state.presence === "AWAY" ? "away" : "home";
    const fetchedAt = new Date().toISOString();
    await savePresenceCache(dataDir(), {
      mode,
      presenceLocked:
        typeof state.presenceLocked === "boolean"
          ? state.presenceLocked
          : null,
      fetchedAt,
      homeId: meta.homeId,
    });
    const label = mode === "home" ? "Zuhause" : "Unterwegs";
    return {
      presence: {
        mode,
        source: "cloud",
        presenceLocked:
          typeof state.presenceLocked === "boolean"
            ? state.presenceLocked
            : null,
        fetchedAt,
        stale: false,
        ttlMinutes: ttlMinutes(),
        message: `Aktuell: ${label}`,
      },
      quota: await getCloudQuota(),
      fetched: true,
    };
  } catch (err) {
    if (err instanceof CloudQuotaExceededError) {
      const fallback = cache
        ? fromCache(
            cache.mode,
            cache.presenceLocked,
            cache.fetchedAt,
            false,
          )
        : unknownStatus("Quota leer — Home/Away konnte nicht aktualisiert werden.");
      fallback.message = `${fallback.message} (Quota erschöpft)`;
      return {
        presence: fallback,
        quota: err.status,
        fetched: false,
      };
    }
    const message = err instanceof Error ? err.message : "Presence fetch failed";
    if (cache) {
      const fallback = fromCache(
        cache.mode,
        cache.presenceLocked,
        cache.fetchedAt,
        false,
      );
      fallback.message = `${fallback.message} · Aktualisieren fehlgeschlagen: ${message}`;
      return {
        presence: fallback,
        quota: await getCloudQuota(),
        fetched: false,
      };
    }
    return {
      presence: unknownStatus(`Home/Away nicht lesbar: ${message}`),
      quota: await getCloudQuota(),
      fetched: false,
    };
  }
}
