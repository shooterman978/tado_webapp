/**
 * In-memory timed overlay tracker (manual setpoint duration).
 * HAP does not expose Tado overlay end times — we track what the PWA sets.
 *
 * @package @heizplan/api
 */

export interface OverlayRecord {
  zoneId: string;
  endsAt: string | null;
  startedAt: string;
  tempC: number | null;
}

const overlays = new Map<string, OverlayRecord>();

export function setOverlay(
  zoneId: string,
  opts: { tempC?: number | null; durationMinutes?: number | null },
): OverlayRecord {
  const startedAt = new Date().toISOString();
  let endsAt: string | null = null;
  if (
    opts.durationMinutes != null &&
    Number.isFinite(opts.durationMinutes) &&
    opts.durationMinutes > 0
  ) {
    endsAt = new Date(
      Date.now() + opts.durationMinutes * 60_000,
    ).toISOString();
  }
  const record: OverlayRecord = {
    zoneId,
    endsAt,
    startedAt,
    tempC: opts.tempC ?? null,
  };
  overlays.set(zoneId, record);
  return record;
}

export function clearOverlayRecord(zoneId: string): void {
  overlays.delete(zoneId);
}

export function getOverlay(zoneId: string): OverlayRecord | null {
  const record = overlays.get(zoneId);
  if (!record) {
    return null;
  }
  if (record.endsAt && Date.parse(record.endsAt) <= Date.now()) {
    overlays.delete(zoneId);
    return null;
  }
  return record;
}

/** Attach overlayEndsAt / overlayActive hints onto a zone copy. */
export function applyOverlayHints<T extends {
  id: string;
  overlayActive: boolean;
  overlayEndsAt?: string | null;
  onSchedule?: boolean;
}>(zone: T): T {
  const record = getOverlay(zone.id);
  if (!record) {
    return {
      ...zone,
      onSchedule: zone.onSchedule ?? !zone.overlayActive,
    };
  }
  return {
    ...zone,
    overlayActive: true,
    overlayEndsAt: record.endsAt,
    onSchedule: false,
  };
}
