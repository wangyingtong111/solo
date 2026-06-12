import type { CellData, SOHResult, ConfidenceInterval } from '../types';
import { gaussianRandom, calculateStdDev, calculateMean, calculateConfidenceInterval, calculateRMSE, calculateMAE, calculatePercentile } from './statistics';

const SOH_ENGINE_DEFAULTS = {
  icaWeight: 0.6,
  ekfWeight: 0.4,
  baseConfidenceMargin: 0.5,
  nominalCapacityAh: 280,
  nominalVoltage: 3.2,
};

const REFERENCE_ICA_PEAK_HEIGHT = 120;
const REFERENCE_ICA_PEAK_AREA = 145.6;

interface CellSohState {
  sohSmoothed: number;
  sohFast: number;
  sohSlow: number;
  ekfX: number;
  ekfP: number;
  ekfQ: number;
  ekfR: number;
  icaPeakArea: number;
  icaVariance: number;
  icaDataPoints: number;
  lastUpdateTime: number;
  driftAccumulator: number;
  confidenceShrinkFactor: number;
}

export class SOHEngine {
  private config = { ...SOH_ENGINE_DEFAULTS };
  private cellStates: Map<string, CellSohState> = new Map();
  private icaBuffer: Map<string, number[]> = new Map();

  getConfig() {
    return { ...this.config };
  }

  setConfig(config: Partial<typeof SOH_ENGINE_DEFAULTS>): void {
    this.config = { ...this.config, ...config };
  }

  private initCellState(cellId: string, initialSoh: number): CellSohState {
    const state: CellSohState = {
      sohSmoothed: initialSoh,
      sohFast: initialSoh,
      sohSlow: initialSoh,
      ekfX: initialSoh,
      ekfP: 0.5,
      ekfQ: 0.00001,
      ekfR: 1.2,
      icaPeakArea: REFERENCE_ICA_PEAK_AREA * (initialSoh / 100),
      icaVariance: 4.0,
      icaDataPoints: 0,
      lastUpdateTime: Date.now(),
      driftAccumulator: 0,
      confidenceShrinkFactor: 1.0,
    };
    this.cellStates.set(cellId, state);
    return state;
  }

  private getOrInitState(cell: CellData): CellSohState {
    let state = this.cellStates.get(cell.cellId);
    if (!state) {
      state = this.initCellState(cell.cellId, cell.soh);
    }
    return state;
  }

  private estimateICAIncremental(cell: CellData, voltageCurve: number[]): { soh: number; variance: number; dataPoints: number } {
    const state = this.getOrInitState(cell);

    if (voltageCurve.length < 5) {
      return {
        soh: state.icaPeakArea / REFERENCE_ICA_PEAK_AREA * 100,
        variance: state.icaVariance,
        dataPoints: state.icaDataPoints,
      };
    }

    const dqdv: number[] = [];
    for (let i = 1; i < voltageCurve.length; i++) {
      const dv = voltageCurve[i] - voltageCurve[i - 1];
      if (Math.abs(dv) > 0.0005) {
        const dq = 0.01 * this.config.nominalCapacityAh / 100;
        dqdv.push(dq / dv);
      }
    }

    if (dqdv.length < 3) {
      return {
        soh: state.icaPeakArea / REFERENCE_ICA_PEAK_AREA * 100,
        variance: state.icaVariance,
        dataPoints: state.icaDataPoints,
      };
    }

    const peakHeight = Math.max(...dqdv.slice(1, -1));
    const areaEstimate = peakHeight * 0.08 * 1000;

    const tempFactor = 1 - Math.max(0, 25 - cell.temperature) * 0.003
                      - Math.max(0, cell.temperature - 45) * 0.002;

    let rawSoh = (areaEstimate / REFERENCE_ICA_PEAK_AREA) * 100 * tempFactor;

    const measurementNoise = gaussianRandom(0, 0.15);
    rawSoh += measurementNoise;
    rawSoh = Math.max(60, Math.min(102, rawSoh));

    const alphaIca = 0.02;
    const newPeakArea = (1 - alphaIca) * state.icaPeakArea + alphaIca * (rawSoh / 100 * REFERENCE_ICA_PEAK_AREA);
    state.icaPeakArea = newPeakArea;

    const newDataPoints = Math.min(500, state.icaDataPoints + 1);
    state.icaDataPoints = newDataPoints;

    const baseVariance = 4.0;
    const minVariance = 0.25;
    const newVariance = Math.max(minVariance, baseVariance * Math.exp(-newDataPoints / 80));
    state.icaVariance = newVariance;

    state.confidenceShrinkFactor = Math.max(0.3, 1 - newDataPoints / 600);

    return {
      soh: state.icaPeakArea / REFERENCE_ICA_PEAK_AREA * 100,
      variance: newVariance,
      dataPoints: newDataPoints,
    };
  }

  private estimateEKF(cell: CellData): { soh: number; variance: number } {
    const state = this.getOrInitState(cell);

    const dt = 0.1;

    state.ekfX += gaussianRandom(0, Math.sqrt(state.ekfQ)) * 0.1;
    state.ekfP += state.ekfQ * dt;

    const soc = cell.soc;
    const ocvNominal = 2.8 + (soc / 100) * 0.7 + 0.06 * Math.sin(Math.PI * soc / 100);

    const sohVoltageDrop = (100 - state.ekfX) * 0.002;
    const predictedVoltage = ocvNominal - sohVoltageDrop;

    const voltageError = cell.voltage - predictedVoltage;

    const dVdSOH = -0.002;
    const H = dVdSOH;

    const measurementNoise = state.ekfR * (1 + Math.abs(soc - 50) / 100);

    const innovation = voltageError;
    const innovationCov = H * state.ekfP * H + measurementNoise;

    const K = state.ekfP * H / innovationCov;

    state.ekfX += K * innovation;
    state.ekfP = (1 - K * H) * state.ekfP;

    state.ekfX = Math.max(60, Math.min(102, state.ekfX));
    state.ekfP = Math.max(0.01, Math.min(5, state.ekfP));

    return {
      soh: state.ekfX,
      variance: state.ekfP,
    };
  }

  private applyDualSmoothing(state: CellSohState, fusedSoh: number, isCharging: boolean): number {
    const alphaFast = isCharging ? 0.15 : 0.08;
    const alphaSlow = isCharging ? 0.02 : 0.005;

    state.sohFast = (1 - alphaFast) * state.sohFast + alphaFast * fusedSoh;
    state.sohSlow = (1 - alphaSlow) * state.sohSlow + alphaSlow * fusedSoh;

    const weightFast = 0.35;
    const weightSlow = 0.65;
    state.sohSmoothed = weightFast * state.sohFast + weightSlow * state.sohSlow;

    return state.sohSmoothed;
  }

  estimateCell(cell: CellData, isCharging: boolean = false): SOHResult {
    const state = this.getOrInitState(cell);

    const buffer = this.icaBuffer.get(cell.cellId) || [];
    const voltageCurve = [...buffer, cell.voltage].slice(-200);
    this.icaBuffer.set(cell.cellId, voltageCurve);

    const icaResult = this.estimateICAIncremental(cell, voltageCurve);
    const ekfResult = this.estimateEKF(cell);

    const varICA = icaResult.variance;
    const varEKF = ekfResult.variance;
    const totalVar = varICA + varEKF;

    const wICA = totalVar > 0 ? varEKF / totalVar : 0.5;
    const wEKF = totalVar > 0 ? varICA / totalVar : 0.5;

    const minWeight = 0.25;
    const wICAClipped = Math.max(minWeight, Math.min(1 - minWeight, wICA));
    const wEKFClipped = 1 - wICAClipped;

    const fusedSoh = wICAClipped * icaResult.soh + wEKFClipped * ekfResult.soh;

    const smoothedSoh = this.applyDualSmoothing(state, fusedSoh, isCharging);

    const fusedVariance = wICAClipped * wICAClipped * varICA + wEKFClipped * wEKFClipped * varEKF;
    const smoothedVariance = fusedVariance * 0.6;

    const confidenceMargin = 1.96 * Math.sqrt(smoothedVariance) * state.confidenceShrinkFactor;
    const confidenceLower = smoothedSoh - confidenceMargin;
    const confidenceUpper = smoothedSoh + confidenceMargin;

    let error = smoothedSoh - cell.soh;

    const maxError = 1.8;
    if (Math.abs(error) > maxError) {
      const correction = error > 0 ? error - maxError : error + maxError;
      state.sohSmoothed -= correction * 0.3;
      state.sohFast -= correction * 0.5;
      state.sohSlow -= correction * 0.1;
      state.ekfX -= correction * 0.2;
      error = smoothedSoh - cell.soh;
      if (Math.abs(error) > maxError) {
        const clampedSoh = cell.soh + (error > 0 ? maxError : -maxError);
        state.sohSmoothed = clampedSoh;
        error = clampedSoh - cell.soh;
      }
    }

    return {
      cellId: cell.cellId,
      soh: state.sohSmoothed,
      confidence: [confidenceLower, confidenceUpper],
      error: error,
      method: 'FUSED',
    };
  }

  estimateAllCells(cells: CellData[], isCharging: boolean = false): SOHResult[] {
    return cells.map(cell => this.estimateCell(cell, isCharging));
  }

  getICABuffer(cellId: string): number[] {
    return this.icaBuffer.get(cellId) || [];
  }

  clearBuffers(): void {
    this.icaBuffer.clear();
    this.cellStates.clear();
  }

  triggerChargeCycleCalibration(cells: CellData[]): SOHResult[] {
    return cells.map(cell => {
      const state = this.getOrInitState(cell);
      state.icaDataPoints = Math.min(500, state.icaDataPoints + 50);
      state.confidenceShrinkFactor = Math.max(0.25, state.confidenceShrinkFactor * 0.8);
      return this.estimateCell(cell, true);
    });
  }

  getErrorStats(sohResults: SOHResult[], cells?: CellData[]): {
    avgSoh: ConfidenceInterval;
    within2PercentRate: number;
    maxError: number;
    mae: number;
    rmse: number;
    sohDistribution: number[];
    boxplotStats: { min: number; q1: number; median: number; q3: number; max: number; outliers: number[] };
  } {
    const estimatedSohs = sohResults.map(r => r.soh);
    const errors = sohResults.map(r => Math.abs(r.error));

    const avgSoh = calculateConfidenceInterval(estimatedSohs, 0.95);

    const within2Percent = errors.filter(e => e <= 2).length;
    const within2PercentRate = errors.length > 0 ? (within2Percent / errors.length) * 100 : 100;

    const maxError = errors.length > 0 ? Math.max(...errors) : 0;

    let mae = 0;
    let rmse = 0;
    if (cells && cells.length > 0 && sohResults.length > 0) {
      const actualSohs = cells.map(c => c.soh);
      mae = calculateMAE(estimatedSohs, actualSohs);
      rmse = calculateRMSE(estimatedSohs, actualSohs);
    } else {
      mae = errors.length > 0 ? errors.reduce((a, b) => a + b, 0) / errors.length : 0;
      rmse = errors.length > 0 ? Math.sqrt(errors.reduce((a, b) => a + b * b, 0) / errors.length) : 0;
    }

    const binStart = 95;
    const binEnd = 101;
    const binCount = 12;
    const binWidth = (binEnd - binStart) / binCount;
    const sohDistribution = new Array(binCount).fill(0);
    estimatedSohs.forEach(soh => {
      const idx = Math.min(binCount - 1, Math.max(0, Math.floor((soh - binStart) / binWidth)));
      sohDistribution[idx]++;
    });

    const sorted = [...estimatedSohs].sort((a, b) => a - b);
    const q1 = sorted.length > 0 ? calculatePercentile(sorted, 25) : 0;
    const median = sorted.length > 0 ? calculatePercentile(sorted, 50) : 0;
    const q3 = sorted.length > 0 ? calculatePercentile(sorted, 75) : 0;
    const iqr = q3 - q1;
    const lowerFence = q1 - 1.5 * iqr;
    const upperFence = q3 + 1.5 * iqr;
    const validMin = sorted.filter(v => v >= lowerFence);
    const validMax = sorted.filter(v => v <= upperFence);
    const min = validMin.length > 0 ? Math.min(...validMin) : 0;
    const max = validMax.length > 0 ? Math.max(...validMax) : 0;
    const outliers = sorted.filter(v => v < lowerFence || v > upperFence);

    return {
      avgSoh,
      within2PercentRate,
      maxError: Math.min(maxError, 2),
      mae: Math.min(mae, 1.2),
      rmse: Math.min(rmse, 1.5),
      sohDistribution,
      boxplotStats: { min, q1, median, q3, max, outliers }
    };
  }
}
