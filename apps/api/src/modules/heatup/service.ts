/**
 * Heat-up learning facade — capture, model update, prediction, outdoor status.
 *
 * @package @heizplan/api
 */

import type {
  HeatupPrediction,
  HeatupRoomSummary,
  HeatupSample,
  HeatupStatus,
  OutdoorProviderId,
  Zone,
} from "@heizplan/shared";
import { config } from "../../config.js";
import { observeZoneHeatup, type ObserveResult } from "./capture.js";
import { HEATUP_DEFAULTS } from "./defaults.js";
import { buildFixtureSamples } from "./fixtures.js";
import { getRoomModel, saveRoomModel } from "./model-store.js";
import {
  getLastOutdoorReading,
  tryOutdoorTemperature,
} from "./outdoor.js";
import {
  predictHeatup,
  rebuildRoomModel,
  type RoomModelState,
} from "./predict.js";
import {
  listSamplesForRoom,
  loadSamples,
  replaceSamples,
  resetHeatupStoreCaches,
} from "./sample-store.js";
import { resetModelStoreCache } from "./model-store.js";

function dataDir(): string {
  return config.bridgeDataDir;
}

export async function getHeatupStatus(): Promise<HeatupStatus> {
  const last = getLastOutdoorReading();
  // Best-effort refresh for status endpoint (stub in tests via env).
  if (!last && config.outdoorProvider === "stub") {
    await tryOutdoorTemperature({ forceStub: true });
  } else if (!last) {
    await tryOutdoorTemperature();
  }
  const reading = getLastOutdoorReading();
  return {
    provider: config.outdoorProvider,
    fallback: config.outdoorFallback,
    lat: config.outdoorLat,
    lon: config.outdoorLon,
    lastOutdoorTempC: reading?.tempC ?? null,
    lastOutdoorAt: reading?.observedAt ?? null,
    lastOutdoorSource: reading?.source ?? null,
    message:
      reading != null
        ? `Outdoor ${reading.tempC.toFixed(1)}°C via ${reading.source}`
        : `Outdoor pending (${config.outdoorProvider}; fallback ${config.outdoorFallback ?? "none"})`,
  };
}

export async function getRoomHeatupState(
  roomId: string,
): Promise<RoomModelState> {
  return getRoomModel(dataDir(), roomId, config.heatupOffsetMin);
}

export async function getRoomSummary(
  roomId: string,
  opts?: { currentTempC?: number | null; targetTempC?: number },
): Promise<HeatupRoomSummary> {
  const samples = await listSamplesForRoom(dataDir(), roomId);
  const ok = samples.filter((s) => s.quality === "ok");
  const rejected = samples.filter((s) => s.quality === "rejected");
  const state = rebuildRoomModel(
    roomId,
    samples,
    config.heatupEmaAlpha,
    config.heatupOffsetMin,
  );
  await saveRoomModel(dataDir(), state);

  const readyForUi = ok.length >= config.heatupMinSamplesForUi;
  let latestPrediction: HeatupPrediction | null = null;
  if (readyForUi || ok.length > 0) {
    const outdoor = getLastOutdoorReading() ?? (await tryOutdoorTemperature());
    const readyAt = new Date();
    readyAt.setHours(7, 0, 0, 0);
    if (readyAt.getTime() < Date.now()) {
      readyAt.setDate(readyAt.getDate() + 1);
    }
    latestPrediction = predictHeatup({
      roomId,
      samples,
      state,
      currentTempC: opts?.currentTempC ?? null,
      targetTempC: opts?.targetTempC ?? 22,
      outdoorTempC: outdoor?.tempC ?? null,
      outdoorProvider: outdoor?.source ?? null,
      readyAt: readyAt.toISOString(),
      manualPreheatMinutes: config.heatupManualPreheatMinutes,
      emaAlpha: config.heatupEmaAlpha,
      minSamplesForUi: config.heatupMinSamplesForUi,
      minSamplesForModel3: config.heatupMinSamplesForModel3,
    });
  }

  return {
    roomId,
    okSampleCount: ok.length,
    rejectedSampleCount: rejected.length,
    lastSampleAt: ok.length ? ok[ok.length - 1].endedAt : null,
    readyForUi,
    latestPrediction,
  };
}

export async function getPrediction(params: {
  roomId: string;
  targetTempC: number;
  currentTempC?: number | null;
  readyAt?: string;
}): Promise<HeatupPrediction> {
  const samples = await listSamplesForRoom(dataDir(), params.roomId);
  const state = rebuildRoomModel(
    params.roomId,
    samples,
    config.heatupEmaAlpha,
    config.heatupOffsetMin,
  );
  await saveRoomModel(dataDir(), state);
  const outdoor = await tryOutdoorTemperature();

  let readyAt = params.readyAt;
  if (!readyAt) {
    const d = new Date();
    d.setHours(7, 0, 0, 0);
    if (d.getTime() < Date.now()) {
      d.setDate(d.getDate() + 1);
    }
    readyAt = d.toISOString();
  }

  return predictHeatup({
    roomId: params.roomId,
    samples,
    state,
    currentTempC: params.currentTempC ?? null,
    targetTempC: params.targetTempC,
    outdoorTempC: outdoor?.tempC ?? null,
    outdoorProvider: (outdoor?.source as OutdoorProviderId) ?? null,
    readyAt,
    manualPreheatMinutes: config.heatupManualPreheatMinutes,
    emaAlpha: config.heatupEmaAlpha,
    minSamplesForUi: config.heatupMinSamplesForUi,
    minSamplesForModel3: config.heatupMinSamplesForModel3,
  });
}

export async function observeRoom(
  roomId: string,
  zonePartial: Partial<Zone>,
): Promise<ObserveResult> {
  const zone: Zone = {
    id: roomId,
    name: zonePartial.name ?? roomId,
    currentTempC: zonePartial.currentTempC ?? null,
    targetTempC: zonePartial.targetTempC ?? null,
    overlayActive: zonePartial.overlayActive ?? false,
    heatingPowerPercent: zonePartial.heatingPowerPercent ?? null,
    windowOpen: zonePartial.windowOpen ?? false,
    openWindowAutoOffActive: zonePartial.openWindowAutoOffActive ?? false,
    updatedAt: zonePartial.updatedAt ?? new Date().toISOString(),
  };

  const result = await observeZoneHeatup(dataDir(), zone);
  if (result.action === "completed") {
    const samples = await listSamplesForRoom(dataDir(), roomId);
    const state = rebuildRoomModel(
      roomId,
      samples,
      config.heatupEmaAlpha,
      config.heatupOffsetMin,
    );
    await saveRoomModel(dataDir(), state);
  }
  return result;
}

export async function listRoomSamples(roomId: string): Promise<HeatupSample[]> {
  return listSamplesForRoom(dataDir(), roomId);
}

export async function seedFixtures(roomId = "zone-bath"): Promise<{
  roomId: string;
  sampleCount: number;
}> {
  const fixtures = buildFixtureSamples(roomId);
  const existing = await loadSamples(dataDir());
  const others = existing.filter((s) => s.roomId !== roomId);
  await replaceSamples(dataDir(), [...others, ...fixtures]);
  const state = rebuildRoomModel(
    roomId,
    fixtures,
    config.heatupEmaAlpha,
    config.heatupOffsetMin,
  );
  await saveRoomModel(dataDir(), state);
  return { roomId, sampleCount: fixtures.length };
}

/** Test helper. */
export function resetHeatupCaches(): void {
  resetHeatupStoreCaches();
  resetModelStoreCache();
}

export { HEATUP_DEFAULTS };
