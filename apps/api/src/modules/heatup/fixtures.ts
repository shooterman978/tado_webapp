/**
 * Dev/fixture heat-up samples for Bad / Wohnzimmer (Lünen-typical outdoor).
 *
 * @package @heizplan/api
 */

import type { HeatupSample } from "@heizplan/shared";
import { buildSample } from "./sample-store.js";

/** Synthetic ok samples spanning outdoor temps for Model 0 → Model 3. */
export function buildFixtureSamples(roomId = "zone-bath"): HeatupSample[] {
  const base: Array<{
    start: number;
    target: number;
    outdoor: number;
    minutes: number;
    day: string;
  }> = [
    { start: 18.0, target: 22.0, outdoor: 2, minutes: 42, day: "2026-01-05" },
    { start: 18.5, target: 22.0, outdoor: 4, minutes: 36, day: "2026-01-08" },
    { start: 19.0, target: 22.0, outdoor: 6, minutes: 30, day: "2026-01-12" },
    { start: 17.5, target: 22.0, outdoor: 0, minutes: 48, day: "2026-01-15" },
    { start: 18.2, target: 22.0, outdoor: 8, minutes: 28, day: "2026-01-20" },
    { start: 19.5, target: 22.0, outdoor: 10, minutes: 22, day: "2026-01-25" },
    { start: 18.0, target: 22.0, outdoor: 3, minutes: 40, day: "2026-02-01" },
    { start: 18.8, target: 22.0, outdoor: 5, minutes: 33, day: "2026-02-05" },
  ];

  const ok = base.map((row, i) =>
    buildSample({
      id: `fixture-ok-${roomId}-${i}`,
      roomId,
      startedAt: `${row.day}T05:30:00.000Z`,
      endedAt: new Date(
        new Date(`${row.day}T05:30:00.000Z`).getTime() + row.minutes * 60_000,
      ).toISOString(),
      startTempC: row.start,
      targetTempC: row.target,
      outdoorTempC: row.outdoor,
      durationMinutes: row.minutes,
      quality: "ok",
    }),
  );

  const rejected = buildSample({
    id: `fixture-rej-${roomId}`,
    roomId,
    startedAt: "2026-02-06T06:00:00.000Z",
    endedAt: "2026-02-06T06:12:00.000Z",
    startTempC: 18,
    targetTempC: 22,
    outdoorTempC: 4,
    durationMinutes: 12,
    quality: "rejected",
    rejectReason: "window_open",
  });

  return [...ok, rejected];
}
