/**
 * In-memory transition trackers for protocol events (no secrets).
 *
 * @package @heizplan/api
 */

import type { CloudQuotaStatus, HomePresenceMode } from "@heizplan/shared";
import { logProtocolEvent } from "./event-log.js";

/** Last known bridge paired flag — detect disconnect/reconnect. */
let lastBridgePaired: boolean | null = null;
/** Last bridge error message we logged (dedupe). */
let lastBridgeErrorMsg: string | null = null;

/** Last presence mode we logged a change for. */
let lastPresenceMode: HomePresenceMode | null = null;

/** Last quota warn/block flags to avoid spam. */
let lastQuotaNear = false;
let lastQuotaBlocked = false;

/** Per-room last windowOpen for open/closed edges. */
const lastWindowOpen = new Map<string, boolean>();

/** Throttle zone-poll noise (one entry per interval). */
let lastZonesPollAt = 0;
const ZONES_POLL_MIN_MS = 45_000;

export function noteBridgeStatus(paired: boolean, message?: string): void {
  if (lastBridgePaired === null) {
    lastBridgePaired = paired;
    return;
  }
  if (lastBridgePaired && !paired) {
    logProtocolEvent({
      category: "bridge",
      type: "bridge.disconnect",
      message: "Bridge-Verbindung verloren",
      actor: { kind: "bridge", label: "Bridge" },
      detail: { message: message ?? null },
    });
  } else if (!lastBridgePaired && paired) {
    logProtocolEvent({
      category: "bridge",
      type: "bridge.reconnect",
      message: "Bridge wieder verbunden",
      actor: { kind: "bridge", label: "Bridge" },
      detail: { message: message ?? null },
    });
    lastBridgeErrorMsg = null;
  }
  lastBridgePaired = paired;
}

export function noteBridgeError(message: string): void {
  const clipped = message.slice(0, 200);
  if (lastBridgeErrorMsg === clipped) {
    return;
  }
  lastBridgeErrorMsg = clipped;
  logProtocolEvent({
    category: "bridge",
    type: "bridge.error",
    message: "Bridge-Fehler",
    actor: { kind: "bridge", label: "Bridge" },
    detail: { message: clipped },
  });
}

export function notePresenceMode(
  mode: HomePresenceMode,
  opts?: { fetched?: boolean },
): void {
  if (mode !== "home" && mode !== "away") {
    return;
  }
  if (lastPresenceMode === null) {
    lastPresenceMode = mode;
    if (opts?.fetched) {
      logProtocolEvent({
        category: "presence",
        type: mode === "home" ? "presence.home" : "presence.away",
        message: mode === "home" ? "Zuhause erkannt" : "Unterwegs erkannt",
        actor: { kind: "presence", label: "Geofencing" },
        detail: { mode, initial: true },
      });
    }
    return;
  }
  if (lastPresenceMode === mode) {
    return;
  }
  const from = lastPresenceMode;
  lastPresenceMode = mode;
  logProtocolEvent({
    category: "presence",
    type: "presence.changed",
    message:
      mode === "home"
        ? "Presence: Unterwegs → Zuhause"
        : "Presence: Zuhause → Unterwegs",
    actor: { kind: "presence", label: "Geofencing" },
    detail: { from, to: mode },
  });
  logProtocolEvent({
    category: "presence",
    type: mode === "home" ? "presence.home" : "presence.away",
    message: mode === "home" ? "Zuhause" : "Unterwegs",
    actor: { kind: "presence", label: "Geofencing" },
    detail: { from },
  });
}

export function noteQuotaStatus(status: CloudQuotaStatus): void {
  if (status.blocked && !lastQuotaBlocked) {
    logProtocolEvent({
      category: "quota",
      type: "quota.blocked",
      message: `Cloud-Kontingent erschöpft (${status.used}/${status.limit})`,
      actor: { kind: "cloud", label: "Cloud" },
      detail: {
        used: status.used,
        limit: status.limit,
        remaining: status.remaining,
        dayKey: status.dayKey,
      },
    });
  } else if (
    status.nearLimit &&
    !status.blocked &&
    (!lastQuotaNear || lastQuotaBlocked)
  ) {
    logProtocolEvent({
      category: "quota",
      type: "quota.near_limit",
      message: `Cloud-Kontingent nahe Limit (${status.remaining} übrig)`,
      actor: { kind: "cloud", label: "Cloud" },
      detail: {
        used: status.used,
        limit: status.limit,
        remaining: status.remaining,
        dayKey: status.dayKey,
      },
    });
  }
  lastQuotaNear = status.nearLimit;
  lastQuotaBlocked = status.blocked;
}

/**
 * Mirror one counted cloud HTTP call into the protocol ring
 * (same source of truth as cloud-quota-log.json).
 */
export function noteCloudRequest(meta: {
  method: string;
  path: string;
  label: string;
  delta: number;
  groupId?: string | null;
  groupLabel?: string | null;
  used: number;
  limit: number;
}): void {
  const label =
    meta.groupLabel?.trim() ||
    meta.label?.trim() ||
    "Cloud-Anfrage";
  const pathShort = meta.path.replace(/^\/api\/v2/, "") || meta.path;
  logProtocolEvent({
    category: "quota",
    type: "quota.request",
    message:
      meta.delta > 1
        ? `Cloud-Request: ${label} (+${meta.delta})`
        : `Cloud-Request: ${label}`,
    actor: {
      kind: "cloud",
      label: (meta.groupLabel?.trim() || "Cloud").slice(0, 80),
    },
    detail: {
      method: meta.method,
      path: pathShort.slice(0, 200),
      delta: meta.delta,
      label: meta.label.slice(0, 120),
      groupId: meta.groupId ?? null,
      groupLabel: meta.groupLabel ?? null,
      used: meta.used,
      limit: meta.limit,
    },
  });
}

export function noteWindowState(
  roomId: string,
  open: boolean,
  source?: string | null,
): void {
  const prev = lastWindowOpen.get(roomId);
  lastWindowOpen.set(roomId, open);
  if (prev === undefined || prev === open) {
    return;
  }
  logProtocolEvent({
    category: "window",
    type: open ? "window.open" : "window.closed",
    message: open ? "Fenster offen erkannt" : "Fenster geschlossen",
    roomId,
    actor: { kind: "window", label: "Fensterregel" },
    detail: { source: source ?? null, open },
  });
}

/** Returns true when a zones-poll protocol entry should be written. */
export function shouldLogZonesPoll(): boolean {
  const now = Date.now();
  if (now - lastZonesPollAt < ZONES_POLL_MIN_MS) {
    return false;
  }
  lastZonesPollAt = now;
  return true;
}

/** Test / DI reset. */
export function resetProtocolTrackers(): void {
  lastBridgePaired = null;
  lastBridgeErrorMsg = null;
  lastPresenceMode = null;
  lastQuotaNear = false;
  lastQuotaBlocked = false;
  lastWindowOpen.clear();
  lastZonesPollAt = 0;
}
