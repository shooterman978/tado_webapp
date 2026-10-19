/**
 * Heat-up prediction — Model 0 (EMA rate) → Model 3 (weather OLS).
 *
 * Algorithm ideas from bbartling/hvac-optimal-start-math-playground (MIT):
 *   Model 0: r_new = ΔT / t_actual; r_EMA = α·r_new + (1-α)·r_EMA; t = ΔT / r_EMA
 *   Model 3: WF = (T_sp − T_oat) / 60; t = β0 + β1·ΔT + β2·(ΔT·WF)
 * Reimplemented in TypeScript (no upstream file copy).
 *
 * Optional offset_min: Comfort-Start-style asymmetric bias (prefer slightly early).
 *
 * @package @heizplan/api
 */

import type {
  HeatupConfidence,
  HeatupPredictMethod,
  HeatupPrediction,
  HeatupSample,
  OutdoorProviderId,
} from "@heizplan/shared";
import { HEATUP_DEFAULTS } from "./defaults.js";

export interface RoomModelState {
  roomId: string;
  /** EMA recovery rate °C/min (Model 0). */
  rateEmaCPerMin: number | null;
  /** Model 3 coefficients [β0, β1, β2] for t = β0 + β1·dT + β2·(dT·WF). */
  model3: { b0: number; b1: number; b2: number } | null;
  /** Extra minutes added to every prediction (asymmetric bias). */
  offsetMin: number;
  okSampleCount: number;
  updatedAt: string | null;
}

export interface PredictInput {
  roomId: string;
  samples: HeatupSample[];
  state: RoomModelState;
  currentTempC: number | null;
  targetTempC: number;
  outdoorTempC: number | null;
  outdoorProvider: OutdoorProviderId | null;
  readyAt: string;
  /** Fallback when no learned model. */
  manualPreheatMinutes: number;
  emaAlpha: number;
  minSamplesForUi: number;
  minSamplesForModel3: number;
}

/** Weather factor as in the math-playground Model 3 notes (°C / 60). */
export function weatherFactor(targetTempC: number, outdoorTempC: number): number {
  return (targetTempC - outdoorTempC) / 60;
}

/**
 * Update Model-0 EMA from one ok sample.
 * r_new = deltaT / durationMinutes (°C/min).
 */
export function updateEmaRate(
  previous: number | null,
  sample: HeatupSample,
  alpha: number,
): number | null {
  if (sample.quality !== "ok" || sample.durationMinutes <= 0 || sample.deltaTC <= 0) {
    return previous;
  }
  const rNew = sample.deltaTC / sample.durationMinutes;
  if (!Number.isFinite(rNew) || rNew <= 0) {
    return previous;
  }
  if (previous == null || !Number.isFinite(previous)) {
    return rNew;
  }
  return alpha * rNew + (1 - alpha) * previous;
}

/**
 * Ordinary least squares for Model 3: X = [1, dT, dT*WF], y = minutes.
 * Returns null if under-determined or singular.
 */
export function fitModel3(
  samples: HeatupSample[],
): { b0: number; b1: number; b2: number } | null {
  const rows = samples.filter(
    (s) =>
      s.quality === "ok" &&
      s.outdoorTempC != null &&
      Number.isFinite(s.outdoorTempC) &&
      s.deltaTC > 0 &&
      s.durationMinutes > 0,
  );
  if (rows.length < 3) {
    return null;
  }

  // Normal equations: (XᵀX) β = Xᵀy  for 3 params.
  const xtx = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const xty = [0, 0, 0];

  for (const s of rows) {
    const dT = s.deltaTC;
    const wf = weatherFactor(s.targetTempC, s.outdoorTempC as number);
    const x = [1, dT, dT * wf];
    const y = s.durationMinutes;
    for (let i = 0; i < 3; i++) {
      xty[i] += x[i] * y;
      for (let j = 0; j < 3; j++) {
        xtx[i][j] += x[i] * x[j];
      }
    }
  }

  const beta = solve3(xtx, xty);
  if (!beta) {
    return null;
  }
  return { b0: beta[0], b1: beta[1], b2: beta[2] };
}

function solve3(
  a: number[][],
  b: number[],
): [number, number, number] | null {
  // Gaussian elimination with partial pivot (3×3).
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let r = col + 1; r < 3; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) {
        pivot = r;
      }
    }
    if (Math.abs(m[pivot][col]) < 1e-9) {
      return null;
    }
    if (pivot !== col) {
      const tmp = m[col];
      m[col] = m[pivot];
      m[pivot] = tmp;
    }
    const div = m[col][col];
    for (let c = col; c < 4; c++) {
      m[col][c] /= div;
    }
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = m[r][col];
      for (let c = col; c < 4; c++) {
        m[r][c] -= f * m[col][c];
      }
    }
  }
  return [m[0][3], m[1][3], m[2][3]];
}

export function predictModel0Minutes(
  deltaTC: number,
  rateEmaCPerMin: number,
  offsetMin: number,
): number {
  const raw = deltaTC / rateEmaCPerMin;
  return Math.max(0, raw + offsetMin);
}

export function predictModel3Minutes(
  deltaTC: number,
  targetTempC: number,
  outdoorTempC: number,
  coeffs: { b0: number; b1: number; b2: number },
  offsetMin: number,
): number {
  const wf = weatherFactor(targetTempC, outdoorTempC);
  const raw = coeffs.b0 + coeffs.b1 * deltaTC + coeffs.b2 * (deltaTC * wf);
  return Math.max(0, raw + offsetMin);
}

function outdoorSpan(samples: HeatupSample[]): number {
  const outs = samples
    .filter((s) => s.quality === "ok" && s.outdoorTempC != null)
    .map((s) => s.outdoorTempC as number);
  if (outs.length < 2) {
    return 0;
  }
  return Math.max(...outs) - Math.min(...outs);
}

function confidence(
  method: HeatupPredictMethod,
  okCount: number,
  minUi: number,
  minM3: number,
): HeatupConfidence {
  if (method === "none" || method === "manual") {
    return okCount > 0 ? "low" : "none";
  }
  if (method === "model3" && okCount >= minM3) {
    return "high";
  }
  if (method === "model0" && okCount >= minUi * 2) {
    return "medium";
  }
  if (okCount >= minUi) {
    return "low";
  }
  return "none";
}

export function predictHeatup(input: PredictInput): HeatupPrediction {
  const {
    roomId,
    samples,
    state,
    currentTempC,
    targetTempC,
    outdoorTempC,
    outdoorProvider,
    readyAt,
    manualPreheatMinutes,
    minSamplesForUi,
    minSamplesForModel3,
  } = input;

  const ok = samples.filter((s) => s.quality === "ok");
  const deltaTC =
    currentTempC != null && Number.isFinite(currentTempC)
      ? Math.max(0, targetTempC - currentTempC)
      : HEATUP_DEFAULTS.deltaBucketC * 2;

  let method: HeatupPredictMethod = "none";
  let estimated: number | null = null;

  const canModel3 =
    ok.length >= minSamplesForModel3 &&
    outdoorTempC != null &&
    outdoorSpan(ok) >= 5 &&
    state.model3 != null;

  if (canModel3 && state.model3) {
    estimated = predictModel3Minutes(
      deltaTC,
      targetTempC,
      outdoorTempC as number,
      state.model3,
      state.offsetMin,
    );
    method = "model3";
  } else if (
    state.rateEmaCPerMin != null &&
    state.rateEmaCPerMin > 0 &&
    ok.length >= 1
  ) {
    estimated = predictModel0Minutes(deltaTC, state.rateEmaCPerMin, state.offsetMin);
    method = "model0";
  } else if (manualPreheatMinutes > 0) {
    estimated = manualPreheatMinutes;
    method = "manual";
  }

  const conf = confidence(
    method,
    ok.length,
    minSamplesForUi,
    minSamplesForModel3,
  );

  let recommendedStartAt: string | null = null;
  if (estimated != null && Number.isFinite(estimated)) {
    const readyMs = new Date(readyAt).getTime();
    recommendedStartAt = new Date(readyMs - estimated * 60_000).toISOString();
  }

  const outdoorLabel =
    outdoorTempC != null ? `${Math.round(outdoorTempC)}°C außen` : "ohne Outdoor";
  const methodLabel =
    method === "model0"
      ? "Model 0"
      : method === "model3"
        ? "Model 3"
        : method === "manual"
          ? "Default-Vorlauf"
          : "keine Schätzung";

  const message =
    estimated != null && recommendedStartAt
      ? `Start empfohlen um ${formatLocalTime(recommendedStartAt)} (Vorlauf ~${Math.round(estimated)} min · ${methodLabel} · ${outdoorLabel})`
      : `Noch zu wenige Aufheiz-Samples (${ok.length}). Outdoor: ${outdoorLabel}.`;

  return {
    roomId,
    targetTempC,
    currentTempC,
    outdoorTempC,
    outdoorProvider,
    estimatedMinutes:
      estimated != null ? Number(estimated.toFixed(1)) : null,
    recommendedStartAt,
    readyAt,
    confidence: conf,
    method,
    sampleCount: ok.length,
    message,
  };
}

function formatLocalTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function emptyRoomModelState(
  roomId: string,
  offsetMin: number,
): RoomModelState {
  return {
    roomId,
    rateEmaCPerMin: null,
    model3: null,
    offsetMin,
    okSampleCount: 0,
    updatedAt: null,
  };
}

/** Rebuild EMA + Model 3 from all ok samples (idempotent). */
export function rebuildRoomModel(
  roomId: string,
  samples: HeatupSample[],
  emaAlpha: number,
  offsetMin: number,
): RoomModelState {
  const ok = samples
    .filter((s) => s.quality === "ok" && s.roomId === roomId)
    .sort((a, b) => a.endedAt.localeCompare(b.endedAt));

  let rate: number | null = null;
  for (const s of ok) {
    rate = updateEmaRate(rate, s, emaAlpha);
  }

  const model3 = fitModel3(ok);

  return {
    roomId,
    rateEmaCPerMin: rate,
    model3,
    offsetMin,
    okSampleCount: ok.length,
    updatedAt: ok.length ? ok[ok.length - 1].endedAt : null,
  };
}
