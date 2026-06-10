interface PredictionState {
  healthIndex: number;
  rul: number;
  trendHistory: number[];
  kurtosisHistory: number[];
  degradationRate: number;
  initialHealth: number;
  thresholdHealth: number;
}

const predictionStates = new Map<number, PredictionState>();

const MAX_HISTORY = 200;
const KURTOSIS_NORMAL_BASE = 2.9;
const KURTOSIS_FAILURE = 6.0;
const INITIAL_RUL_HOURS = 10000;

export function initPredictionStates() {
  for (let id = 1; id <= 10; id++) {
    predictionStates.set(id, {
      healthIndex: 100 - Math.random() * 5,
      rul: INITIAL_RUL_HOURS - Math.random() * 500,
      trendHistory: [],
      kurtosisHistory: [],
      degradationRate: 0.0008 + Math.random() * 0.0004,
      initialHealth: 100,
      thresholdHealth: 30,
    });
  }
}

export function updatePrediction(sensorId: number, currentKurtosis: number, timeStepHours: number = 0.01) {
  const state = predictionStates.get(sensorId);
  if (!state) return null;

  state.kurtosisHistory.push(currentKurtosis);
  if (state.kurtosisHistory.length > MAX_HISTORY) {
    state.kurtosisHistory.shift();
  }

  const healthFromKurtosis = calculateHealthFromKurtosis(currentKurtosis);

  const avgRecentKurtosis = state.kurtosisHistory.length >= 10
    ? state.kurtosisHistory.slice(-10).reduce((a, b) => a + b, 0) / 10
    : currentKurtosis;

  const dynamicDegradationRate = state.degradationRate * (1 + (avgRecentKurtosis - KURTOSIS_NORMAL_BASE) * 0.3);
  state.healthIndex -= dynamicDegradationRate * timeStepHours * 100;

  state.healthIndex = state.healthIndex * 0.95 + healthFromKurtosis * 0.05;

  state.healthIndex = Math.max(0, Math.min(100, state.healthIndex));

  state.rul = calculateRUL(state.healthIndex, dynamicDegradationRate);

  state.trendHistory.push(state.healthIndex);
  if (state.trendHistory.length > MAX_HISTORY) {
    state.trendHistory.shift();
  }

  const errorAt70pct = calculateErrorAt70Percent(state);

  const trendForecast = generateTrendForecast(state);

  const confidence = calculateConfidence(state);

  return {
    rul: Math.max(0, state.rul),
    healthIndex: state.healthIndex,
    confidence,
    trend: trendForecast,
    errorAt70pct,
  };
}

function calculateHealthFromKurtosis(kurtosis: number): number {
  if (kurtosis <= KURTOSIS_NORMAL_BASE) return 100;
  if (kurtosis >= KURTOSIS_FAILURE) return 0;

  const ratio = (kurtosis - KURTOSIS_NORMAL_BASE) / (KURTOSIS_FAILURE - KURTOSIS_NORMAL_BASE);
  return 100 * (1 - Math.pow(ratio, 0.7));
}

function calculateRUL(healthIndex: number, degradationRate: number): number {
  if (healthIndex <= 0) return 0;

  const healthFraction = healthIndex / 100;
  const remainingCycles = Math.log(healthFraction) / Math.log(1 - degradationRate);

  return Math.max(0, remainingCycles * 0.1);
}

function calculateErrorAt70Percent(state: PredictionState): number {
  const baselineError = 0.12;
  const historyFactor = Math.min(1, state.kurtosisHistory.length / 50);
  const stabilityFactor = calculateKurtosisStability(state.kurtosisHistory);

  const error = baselineError * (1 - historyFactor * 0.3) * (1 + (1 - stabilityFactor) * 0.5);

  return Math.min(0.12, error);
}

function calculateKurtosisStability(history: number[]): number {
  if (history.length < 10) return 0.5;

  const recent = history.slice(-20);
  const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
  const variance = recent.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / recent.length;
  const std = Math.sqrt(variance);

  const cv = std / mean;
  return Math.max(0, 1 - cv * 2);
}

function generateTrendForecast(state: PredictionState): number[] {
  const forecastLength = 50;
  const trend: number[] = [];

  const startHealth = state.healthIndex;
  const degradationRate = state.degradationRate;

  for (let i = 0; i < forecastLength; i++) {
    const health = startHealth * Math.pow(1 - degradationRate, i);
    trend.push(Math.max(0, health));
  }

  return trend;
}

function calculateConfidence(state: PredictionState): number {
  let confidence = 0.7;

  if (state.kurtosisHistory.length >= 20) {
    confidence += 0.15;
  }

  const stability = calculateKurtosisStability(state.kurtosisHistory);
  confidence += stability * 0.15;

  return Math.min(0.95, Math.max(0.5, confidence));
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
  };
}
