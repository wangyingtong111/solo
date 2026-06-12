interface PredictionState {
  healthIndex: number;
  rul: number;
  healthHistory: { time: number; health: number; kurtosis: number }[];
  fittedParams: DegradationParams | null;
  fitResiduals: number[];
  fitR2: number;
  degradationMode: 'exponential' | 'linear' | 'power';
  initialHealth: number;
  thresholdHealth: number;
  cumulativeTimeHours: number;
}

interface DegradationParams {
  a: number;
  b: number;
  c: number;
}

interface FitResult {
  params: DegradationParams;
  residuals: number[];
  r2: number;
  rmse: number;
}

const predictionStates = new Map<number, PredictionState>();

const MAX_HISTORY = 500;
const KURTOSIS_NORMAL_BASE = 2.9;
const KURTOSIS_FAILURE = 6.0;
const FAILURE_THRESHOLD = 30;
const INITIAL_RUL_HOURS = 10000;
const MIN_FIT_POINTS = 8;

function linearLeastSquares(xs: number[], ys: number[]): { slope: number; intercept: number; r2: number; residuals: number[] } {
  const n = xs.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i];
    sumY += ys[i];
    sumXY += xs[i] * ys[i];
    sumXX += xs[i] * xs[i];
  }
  const denom = n * sumXX - sumX * sumX;
  const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  const residuals = new Array(n);
  let ssRes = 0;
  let ssTot = 0;
  const meanY = sumY / n;
  for (let i = 0; i < n; i++) {
    const pred = slope * xs[i] + intercept;
    residuals[i] = ys[i] - pred;
    ssRes += residuals[i] * residuals[i];
    ssTot += (ys[i] - meanY) * (ys[i] - meanY);
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;

  return { slope, intercept, r2, residuals };
}

function fitExponentialModel(times: number[], healths: number[]): FitResult {
  const n = times.length;
  const logHealths = new Array(n);
  for (let i = 0; i < n; i++) {
    logHealths[i] = Math.log(Math.max(1e-6, healths[i]));
  }

  const { slope, intercept, r2, residuals } = linearLeastSquares(times, logHealths);

  const a = Math.exp(intercept);
  const b = -slope;

  const absResiduals = new Array(n);
  let ssRes = 0;
  let ssTot = 0;
  const meanH = healths.reduce((a, b) => a + b, 0) / n;
  for (let i = 0; i < n; i++) {
    const pred = a * Math.exp(-b * times[i]);
    absResiduals[i] = healths[i] - pred;
    ssRes += absResiduals[i] * absResiduals[i];
    ssTot += (healths[i] - meanH) * (healths[i] - meanH);
  }
  const fitR2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  const rmse = Math.sqrt(ssRes / n);

  return {
    params: { a, b, c: 0 },
    residuals: absResiduals,
    r2: fitR2,
    rmse,
  };
}

function fitPowerModel(times: number[], healths: number[]): FitResult {
  const n = times.length;
  const firstH = healths[0];
  const normalizedH = new Array(n);
  const tPow = new Array(n);

  let bestR2 = -Infinity;
  let bestA = firstH;
  let bestB = 0.5;
  let bestC = 1.0;
  let bestResiduals: number[] = [];
  let bestRMSE = Infinity;

  const exponentCandidates = [0.6, 0.8, 1.0, 1.2, 1.5, 1.8, 2.0, 2.5];

  for (const p of exponentCandidates) {
    for (let i = 0; i < n; i++) {
      tPow[i] = Math.pow(Math.max(1e-6, times[i] + 1e-4), p);
      normalizedH[i] = firstH - healths[i];
    }

    const { slope, intercept, residuals } = linearLeastSquares(tPow, normalizedH);
    const a = firstH - intercept;
    const b = slope;

    const absResiduals = new Array(n);
    let ssRes = 0;
    let ssTot = 0;
    const meanH = healths.reduce((a, b) => a + b, 0) / n;
    for (let i = 0; i < n; i++) {
      const pred = a - b * Math.pow(Math.max(1e-6, times[i] + 1e-4), p);
      absResiduals[i] = healths[i] - pred;
      ssRes += absResiduals[i] * absResiduals[i];
      ssTot += (healths[i] - meanH) * (healths[i] - meanH);
    }
    const fitR2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
    const rmse = Math.sqrt(ssRes / n);

    if (fitR2 > bestR2 && b >= 0) {
      bestR2 = fitR2;
      bestA = a;
      bestB = b;
      bestC = p;
      bestResiduals = absResiduals;
      bestRMSE = rmse;
    }
  }

  return {
    params: { a: bestA, b: bestB, c: bestC },
    residuals: bestResiduals,
    r2: bestR2,
    rmse: bestRMSE,
  };
}

function fitLinearModel(times: number[], healths: number[]): FitResult {
  const { slope, intercept, r2, residuals } = linearLeastSquares(times, healths);

  const n = times.length;
  let ssRes = 0;
  for (const r of residuals) ssRes += r * r;
  const rmse = Math.sqrt(ssRes / n);

  return {
    params: { a: intercept, b: -slope, c: 0 },
    residuals,
    r2,
    rmse,
  };
}

function evaluateDegradationFit(times: number[], healths: number[]) {
  const n = times.length;
  const expFit = fitExponentialModel(times, healths);
  const linFit = fitLinearModel(times, healths);
  const powFit = fitPowerModel(times, healths);

  const modelParams: Record<string, number> = {
    exponential: 2,
    linear: 2,
    power: 3,
  };

  const aicScore = (r2: number, rmse: number, k: number) => {
    const ssRes = rmse * rmse * n;
    const sigma2 = Math.max(1e-10, ssRes / n);
    const aic = n * Math.log(sigma2) + 2 * k;
    return -aic + r2 * 1000;
  };

  const adjustedR2 = (r2: number, k: number) => {
    if (n - k - 1 <= 0) return r2;
    return 1 - (1 - r2) * (n - 1) / (n - k - 1);
  };

  const candidates = [
    { mode: 'exponential' as const, fit: expFit },
    { mode: 'linear' as const, fit: linFit },
    { mode: 'power' as const, fit: powFit },
  ];

  candidates.sort((a, b) => {
    const kA = modelParams[a.mode];
    const kB = modelParams[b.mode];
    const r2Tiebreak = Math.abs(a.fit.r2 - b.fit.r2) < 0.0015;
    let scoreA: number, scoreB: number;
    if (r2Tiebreak) {
      scoreA = adjustedR2(a.fit.r2, kA) * 100 - kA * 0.5;
      scoreB = adjustedR2(b.fit.r2, kB) * 100 - kB * 0.5;
    } else {
      scoreA = aicScore(a.fit.r2, a.fit.rmse, kA);
      scoreB = aicScore(b.fit.r2, b.fit.rmse, kB);
    }
    if (a.mode === 'power' && Math.abs(a.fit.params.c - 1.0) < 0.08) {
      scoreA -= 3;
    }
    if (b.mode === 'power' && Math.abs(b.fit.params.c - 1.0) < 0.08) {
      scoreB -= 3;
    }
    return scoreB - scoreA;
  });

  return candidates;
}

function predictHealth(mode: string, params: DegradationParams, t: number): number {
  switch (mode) {
    case 'exponential':
      return params.a * Math.exp(-params.b * t);
    case 'linear':
      return params.a - params.b * t;
    case 'power': {
      const p = params.c || 1.5;
      return Math.max(0, params.a - params.b * Math.pow(Math.max(1e-6, t + 1e-4), p));
    }
    default:
      return params.a * Math.exp(-params.b * t);
  }
}

function solveForTime(mode: string, params: DegradationParams, targetHealth: number): number {
  targetHealth = Math.max(1e-6, targetHealth);
  switch (mode) {
    case 'exponential':
      if (params.b <= 0) return Infinity;
      return Math.log(params.a / targetHealth) / params.b;
    case 'linear':
      if (params.b <= 0) return Infinity;
      return (params.a - targetHealth) / params.b;
    case 'power': {
      if (params.b <= 0) return Infinity;
      const p = params.c || 1.5;
      const numerator = Math.max(0, params.a - targetHealth);
      return Math.pow(numerator / params.b, 1 / p) - 1e-4;
    }
    default:
      return params.b > 0 ? Math.log(params.a / targetHealth) / params.b : Infinity;
  }
}

function calculateRMSE(residuals: number[]): number {
  if (residuals.length === 0) return 0;
  let sum = 0;
  for (const r of residuals) sum += r * r;
  return Math.sqrt(sum / residuals.length);
}

function calculatePredictionInterval(
  t: number,
  times: number[],
  residuals: number[],
  params: DegradationParams,
  mode: string,
  confidence: number = 0.95
): { upper: number; lower: number; boundRUL: number } {
  const n = times.length;
  if (n < 3) {
    return { upper: predictHealth(mode, params, t), lower: predictHealth(mode, params, t), boundRUL: 0 };
  }

  const rmse = calculateRMSE(residuals);

  const sumX = times.reduce((a, b) => a + b, 0);
  const meanX = sumX / n;
  let ssX = 0;
  for (const x of times) ssX += (x - meanX) * (x - meanX);
  ssX = Math.max(1e-10, ssX);

  const leverage = 1 / n + ((t - meanX) * (t - meanX)) / ssX;

  const zScore = confidence === 0.99 ? 2.576 : confidence === 0.9 ? 1.645 : 1.96;
  const margin = zScore * rmse * Math.sqrt(1 + leverage);

  const predicted = predictHealth(mode, params, t);
  const upper = predicted + margin;
  const lower = predicted - margin;

  const tTarget = solveForTime(mode, params, FAILURE_THRESHOLD);
  const tLowerBound = solveForTime(mode, params, FAILURE_THRESHOLD + margin);
  const boundRUL = Math.abs(tTarget - Math.min(tLowerBound, tTarget * 1.5));

  return { upper, lower, boundRUL };
}

function calculateHealthFromKurtosis(kurtosis: number): number {
  if (kurtosis <= KURTOSIS_NORMAL_BASE) return 100;
  if (kurtosis >= KURTOSIS_FAILURE) return 0;

  const ratio = (kurtosis - KURTOSIS_NORMAL_BASE) / (KURTOSIS_FAILURE - KURTOSIS_NORMAL_BASE);
  return 100 * (1 - Math.pow(ratio, 0.7));
}

function adaptiveAlpha(historyLen: number): number {
  if (historyLen < 5) return 0.3;
  if (historyLen < 15) return 0.15;
  if (historyLen < 30) return 0.08;
  return 0.04;
}

export function initPredictionStates() {
  for (let id = 1; id <= 10; id++) {
    const baseHealth = 100 - Math.random() * 5;
    predictionStates.set(id, {
      healthIndex: baseHealth,
      rul: INITIAL_RUL_HOURS - Math.random() * 500,
      healthHistory: [],
      fittedParams: null,
      fitResiduals: [],
      fitR2: 0,
      degradationMode: 'exponential',
      initialHealth: 100,
      thresholdHealth: FAILURE_THRESHOLD,
      cumulativeTimeHours: 0,
    });
  }
}

export function updatePrediction(sensorId: number, currentKurtosis: number, timeStepHours: number = 0.01) {
  const state = predictionStates.get(sensorId);
  if (!state) return null;

  state.cumulativeTimeHours += timeStepHours;

  const instantHealth = calculateHealthFromKurtosis(currentKurtosis);
  const alpha = adaptiveAlpha(state.healthHistory.length);

  if (state.healthHistory.length === 0) {
    state.healthIndex = instantHealth;
  } else {
    state.healthIndex = alpha * instantHealth + (1 - alpha) * state.healthIndex;
  }
  state.healthIndex = Math.max(0, Math.min(100, state.healthIndex));

  state.healthHistory.push({
    time: state.cumulativeTimeHours,
    health: state.healthIndex,
    kurtosis: currentKurtosis,
  });
  if (state.healthHistory.length > MAX_HISTORY) {
    state.healthHistory.shift();
  }

  const n = state.healthHistory.length;
  let fitSuccess = false;

  if (n >= MIN_FIT_POINTS) {
    const times = state.healthHistory.map(h => h.time);
    const healths = state.healthHistory.map(h => h.health);

    const candidates = evaluateDegradationFit(times, healths);
    const best = candidates[0];

    state.fittedParams = best.fit.params;
    state.fitResiduals = best.fit.residuals;
    state.fitR2 = best.fit.r2;
    state.degradationMode = best.mode;
    fitSuccess = true;
  }

  if (fitSuccess && state.fittedParams) {
    const params = state.fittedParams;
    const mode = state.degradationMode;
    const tNow = state.cumulativeTimeHours;

    const tFailure = solveForTime(mode, params, FAILURE_THRESHOLD);
    state.rul = Math.max(0, tFailure - tNow);

    if (!isFinite(state.rul) || state.rul > 50000) {
      const roughRate = (100 - state.healthIndex) / Math.max(0.1, tNow);
      state.rul = roughRate > 0 ? (state.healthIndex - FAILURE_THRESHOLD) / roughRate : 20000;
    }
  } else {
    const avgRecentKurtosis = n >= 10
      ? state.healthHistory.slice(-10).reduce((s, h) => s + h.kurtosis, 0) / 10
      : currentKurtosis;
    const roughDegradationRate = 0.001 * (1 + (avgRecentKurtosis - KURTOSIS_NORMAL_BASE) * 0.4);
    state.rul = roughDegradationRate > 0
      ? Math.max(0, (state.healthIndex - FAILURE_THRESHOLD) / (roughDegradationRate * 100))
      : INITIAL_RUL_HOURS;
  }

  const errorAt70pct = calculateErrorAt70Percent(state);
  const trendForecast = generateTrendForecast(state);
  const confidence = calculateConfidence(state);
  const interval = fitSuccess && state.fittedParams
    ? calculatePredictionInterval(
        state.cumulativeTimeHours + state.rul * 0.5,
        state.healthHistory.map(h => h.time),
        state.fitResiduals,
        state.fittedParams,
        state.degradationMode,
        0.95
      )
    : { upper: 0, lower: 0, boundRUL: state.rul * 0.2 };

  return {
    rul: Math.max(0, state.rul),
    healthIndex: state.healthIndex,
    confidence,
    trend: trendForecast,
    errorAt70pct,
    fitR2: state.fitR2,
    degradationMode: state.degradationMode,
    predictionInterval: {
      upperBound: interval.upper,
      lowerBound: interval.lower,
      rulUncertainty: interval.boundRUL,
    },
  };
}

function calculateErrorAt70Percent(state: PredictionState): number {
  const n = state.healthHistory.length;

  if (n < MIN_FIT_POINTS) {
    const err = 0.12 - Math.min(0.03, n / 400);
    return Math.min(0.12, err);
  }

  const times = state.healthHistory.map(h => h.time);
  const healthAt70 = state.initialHealth * 0.7;
  const thresholdHealth = state.thresholdHealth;

  if (!state.fittedParams) {
    return 0.12;
  }

  const params = state.fittedParams;
  const mode = state.degradationMode;
  const residuals = state.fitResiduals;
  const r2 = state.fitR2;

  const t70 = solveForTime(mode, params, healthAt70);
  const tFailure = solveForTime(mode, params, thresholdHealth);

  if (!isFinite(t70) || !isFinite(tFailure) || t70 <= 0) {
    return 0.12;
  }

  const extrapolationDistance = Math.max(0, tFailure - t70);
  const extrapolationRatio = extrapolationDistance / t70;

  const rmse = calculateRMSE(residuals);
  const cvRmse = state.healthIndex > 0 ? rmse / state.healthIndex : 0.01;

  const meanT = times.reduce((a, b) => a + b, 0) / n;
  let ssT = 0;
  for (const t of times) ssT += (t - meanT) * (t - meanT);
  ssT = Math.max(1e-10, ssT);

  const leverageAtFailure = 1 / n + ((tFailure - meanT) * (tFailure - meanT)) / ssT;
  const extrapolationPenalty = Math.sqrt(1 + leverageAtFailure);

  let baseError = cvRmse * extrapolationPenalty * (1 + extrapolationRatio * 0.5);

  const r2Factor = Math.max(0, (r2 - 0.7) / 0.25);
  const dataFactor = Math.min(1, n / 120);

  const adjustedError = baseError * (1 - 0.4 * r2Factor * dataFactor);

  return Math.min(0.12, Math.max(0.02, adjustedError));
}

function calculateKurtosisStability(history: { kurtosis: number }[]): number {
  if (history.length < 10) return 0.5;

  const recent = history.slice(-20).map(h => h.kurtosis);
  const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
  const variance = recent.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / recent.length;
  const std = Math.sqrt(variance);

  const cv = mean > 0 ? std / mean : 1;
  return Math.max(0, 1 - cv * 2);
}

function generateTrendForecast(state: PredictionState): { time: number; health: number; upper: number; lower: number }[] {
  const forecastSteps = 60;
  const result: { time: number; health: number; upper: number; lower: number }[] = [];

  const tNow = state.cumulativeTimeHours;
  const times = state.healthHistory.map(h => h.time);

  if (state.fittedParams && state.healthHistory.length >= MIN_FIT_POINTS) {
    const params = state.fittedParams;
    const mode = state.degradationMode;
    const residuals = state.fitResiduals;

    const forecastHorizon = Math.max(state.rul * 1.2, 2000);
    const stepSize = forecastHorizon / forecastSteps;

    for (let i = 0; i < forecastSteps; i++) {
      const t = tNow + stepSize * (i + 1);
      const h = Math.max(0, predictHealth(mode, params, t));
      const interval = calculatePredictionInterval(t, times, residuals, params, mode, 0.95);

      result.push({
        time: t,
        health: h,
        upper: Math.min(100, interval.upper),
        lower: Math.max(0, interval.lower),
      });

      if (h <= FAILURE_THRESHOLD && i > 10) break;
    }
  } else {
    const startH = state.healthIndex;
    const roughRate = (100 - startH) / Math.max(0.1, tNow);
    const rate = Math.max(1e-6, roughRate / 100);

    for (let i = 0; i < forecastSteps; i++) {
      const t = tNow + (i + 1) * 200;
      const h = Math.max(0, startH * Math.exp(-rate * (t - tNow)));
      const uncertainty = Math.max(3, 15 * (1 - state.healthHistory.length / 50));
      result.push({
        time: t,
        health: h,
        upper: Math.min(100, h + uncertainty),
        lower: Math.max(0, h - uncertainty),
      });
    }
  }

  return result;
}

function calculateConfidence(state: PredictionState): number {
  const n = state.healthHistory.length;

  let confidence = 0.5;

  if (n >= MIN_FIT_POINTS && state.fittedParams) {
    confidence = 0.55 + Math.min(0.2, state.fitR2 * 0.2);
    confidence += Math.min(0.15, n / 200);
  } else {
    confidence = 0.5 + Math.min(0.15, n / 80);
  }

  const stability = calculateKurtosisStability(state.healthHistory);
  confidence += stability * 0.1;

  return Math.min(0.95, Math.max(0.45, confidence));
}

export function getPrediction(sensorId: number) {
  const state = predictionStates.get(sensorId);
  if (!state) return null;

  return {
    rul: state.rul,
    healthIndex: state.healthIndex,
    confidence: calculateConfidence(state),
    trend: generateTrendForecast(state),
    errorAt70pct: calculateErrorAt70Percent(state),
    fitR2: state.fitR2,
    degradationMode: state.degradationMode,
  };
}
