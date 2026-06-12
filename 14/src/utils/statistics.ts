import type { ConfidenceInterval } from '../types';

export function calculateMean(data: number[]): number {
  if (data.length === 0) return 0;
  return data.reduce((sum, val) => sum + val, 0) / data.length;
}

export function calculateStdDev(data: number[]): number {
  if (data.length === 0) return 0;
  const mean = calculateMean(data);
  const squaredDiffs = data.map((val) => Math.pow(val - mean, 2));
  const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / (data.length - 1);
  return Math.sqrt(variance);
}

function tCriticalValue(df: number, confidenceLevel: number): number {
  const alpha = 1 - confidenceLevel;
  const alpha2 = alpha / 2;
  if (df <= 0) return 1.96;
  if (df > 1000) return 1.96;
  
  const tTable: Record<number, number> = {
    1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571,
    6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228,
    11: 2.201, 12: 2.179, 13: 2.160, 14: 2.145, 15: 2.131,
    16: 2.120, 17: 2.110, 18: 2.101, 19: 2.093, 20: 2.086,
    21: 2.080, 22: 2.074, 23: 2.069, 24: 2.064, 25: 2.060,
    26: 2.056, 27: 2.052, 28: 2.048, 29: 2.045, 30: 2.042,
    40: 2.021, 50: 2.009, 60: 2.000, 80: 1.990, 100: 1.984,
    200: 1.972, 500: 1.965, 1000: 1.962
  };
  
  if (tTable[df]) return tTable[df];
  
  const keys = Object.keys(tTable).map(Number).sort((a, b) => a - b);
  let lower = keys[0];
  let upper = keys[keys.length - 1];
  for (let i = 0; i < keys.length - 1; i++) {
    if (df > keys[i] && df < keys[i + 1]) {
      lower = keys[i];
      upper = keys[i + 1];
      break;
    }
  }
  
  if (lower === upper) return tTable[lower];
  
  const ratio = (df - lower) / (upper - lower);
  return tTable[lower] + ratio * (tTable[upper] - tTable[lower]);
}

export function calculateConfidenceInterval(
  data: number[],
  confidenceLevel: number = 0.95
): ConfidenceInterval {
  const n = data.length;
  const mean = calculateMean(data);
  const stdDev = n > 1 ? calculateStdDev(data) : 0;
  
  if (n <= 1) {
    return {
      mean,
      lower95: mean,
      upper95: mean,
      standardDeviation: stdDev,
      sampleSize: n
    };
  }
  
  const df = n - 1;
  const tValue = tCriticalValue(df, confidenceLevel);
  const standardError = stdDev / Math.sqrt(n);
  const marginOfError = tValue * standardError;
  
  return {
    mean,
    lower95: mean - marginOfError,
    upper95: mean + marginOfError,
    standardDeviation: stdDev,
    sampleSize: n
  };
}

export function calculatePercentile(data: number[], p: number): number {
  if (data.length === 0) return 0;
  const sorted = [...data].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const fraction = index - lower;
  return sorted[lower] + fraction * (sorted[upper] - sorted[lower]);
}

export function calculateRMSE(estimated: number[], actual: number[]): number {
  if (estimated.length === 0 || actual.length === 0) return 0;
  const n = Math.min(estimated.length, actual.length);
  let sumSquaredError = 0;
  for (let i = 0; i < n; i++) {
    const error = estimated[i] - actual[i];
    sumSquaredError += error * error;
  }
  return Math.sqrt(sumSquaredError / n);
}

export function calculateMAE(estimated: number[], actual: number[]): number {
  if (estimated.length === 0 || actual.length === 0) return 0;
  const n = Math.min(estimated.length, actual.length);
  let sumAbsError = 0;
  for (let i = 0; i < n; i++) {
    sumAbsError += Math.abs(estimated[i] - actual[i]);
  }
  return sumAbsError / n;
}

export function gaussianRandom(mean: number, std: number): number {
  let u1 = 0;
  let u2 = 0;
  while (u1 === 0) u1 = Math.random();
  while (u2 === 0) u2 = Math.random();
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return z0 * std + mean;
}
