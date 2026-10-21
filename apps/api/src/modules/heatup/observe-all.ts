/**
 * Observe all zones for heat-up sessions (called from zone list refresh).
 *
 * @package @heizplan/api
 */

import type { Zone } from "@heizplan/shared";
import { config } from "../../config.js";
import { observeZoneHeatup, type ObserveResult } from "./capture.js";
import { saveRoomModel } from "./model-store.js";
import { rebuildRoomModel } from "./predict.js";
import { listSamplesForRoom, loadSamples } from "./sample-store.js";
import { logProtocolEvent } from "../protocol/event-log.js";
import { tryOutdoorTemperature } from "./outdoor.js";
import { getPrediction } from "./service.js";

/**
 * Run capture for every zone. Refreshes outdoor cache at most once per batch
 * (TTL inside outdoor client). Rebuilds Model 0/3 when a session completes.
 */
export async function observeAllZonesHeatup(
  zones: Zone[],
): Promise<ObserveResult[]> {
  if (!config.heatupEnabled) {
    return [];
  }

  await tryOutdoorTemperature();

  const results: ObserveResult[] = [];
  for (const zone of zones) {
    try {
      const result = await observeZoneHeatup(config.bridgeDataDir, zone);
      results.push(result);
      if (result.action === "completed") {
        const samples = await listSamplesForRoom(
          config.bridgeDataDir,
          zone.id,
        );
        const state = rebuildRoomModel(
          zone.id,
          samples,
          config.heatupEmaAlpha,
          config.heatupOffsetMin,
        );
        await saveRoomModel(config.bridgeDataDir, state);
        console.info(
          `[heatup] sample ok ${zone.id} (${state.okSampleCount} ok, rate=${state.rateEmaCPerMin?.toFixed(3) ?? "n/a"} °C/min)`,
        );
        logProtocolEvent({
          category: "heatup",
          type: "heatup.accept",
          message: "Heat-up-Sample übernommen",
          roomId: zone.id,
          actor: { kind: "heatup", label: "Vorwärmen" },
          detail: {
            sampleId: result.sampleId ?? null,
            okSampleCount: state.okSampleCount,
            rateEmaCPerMin: state.rateEmaCPerMin ?? null,
          },
        });
      } else if (result.action === "rejected") {
        console.info(
          `[heatup] sample rejected ${zone.id}: ${result.reason ?? "?"}`,
        );
        logProtocolEvent({
          category: "heatup",
          type: "heatup.reject",
          message: `Heat-up-Sample verworfen (${result.reason ?? "?"})`,
          roomId: zone.id,
          actor: { kind: "heatup", label: "Vorwärmen" },
          detail: {
            sampleId: result.sampleId ?? null,
            reason: result.reason ?? null,
          },
        });
      } else if (result.action === "started") {
        console.info(`[heatup] session started ${zone.id}`);
        logProtocolEvent({
          category: "heatup",
          type: "heatup.started",
          message: "Heat-up-Messung gestartet",
          roomId: zone.id,
          actor: { kind: "heatup", label: "Vorwärmen" },
          detail: { action: "started" },
        });
      }
    } catch (err) {
      console.warn(
        `[heatup] observe failed ${zone.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return results;
}

/**
 * Attach compact heat-up tips only for rooms that already have enough ok samples.
 */
export async function attachHeatupHints(zones: Zone[]): Promise<Zone[]> {
  if (!config.heatupEnabled) {
    return zones;
  }

  const all = await loadSamples(config.bridgeDataDir);
  const okByRoom = new Map<string, number>();
  for (const s of all) {
    if (s.quality === "ok") {
      okByRoom.set(s.roomId, (okByRoom.get(s.roomId) ?? 0) + 1);
    }
  }

  const out: Zone[] = [];
  for (const zone of zones) {
    const count = okByRoom.get(zone.id) ?? 0;
    if (count < config.heatupMinSamplesForUi) {
      out.push({ ...zone, heatupHint: null });
      continue;
    }
    try {
      const prediction = await getPrediction({
        roomId: zone.id,
        targetTempC: zone.targetTempC ?? 22,
        currentTempC: zone.currentTempC,
      });
      out.push({
        ...zone,
        heatupHint: {
          recommendedStartAt: prediction.recommendedStartAt,
          estimatedMinutes: prediction.estimatedMinutes,
          outdoorTempC: prediction.outdoorTempC,
          method: prediction.method,
          message: prediction.message,
          sampleCount: prediction.sampleCount,
        },
      });
    } catch {
      out.push({ ...zone, heatupHint: null });
    }
  }
  return out;
}
