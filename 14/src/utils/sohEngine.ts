import type { CellData, SOHResult, ConfidenceInterval } from '../types';
import { gaussianRandom, calculateStdDev, calculateMean, calculateConfidenceInterval, calculateRMSE, calculateMAE, calculatePercentile } from './statistics';

const SOH_ENGINE_DEFAULTS = {
  icaWeight: 0.6,
  ekfWeight: 0.4,
  baseConfidenceMargin: 0.5
};

export class SOHEngine {
  private config = { ...SOH_ENGINE_DEFAULTS };
  private icaBuffer: Map<string, number[]> = new Map();
  private ekfState: Map<string, { x: number; P: number; Q: number; R: number }> = new Map();

  getConfig() {
    return { ...this.config };
  }

  setConfig(config: Partial<typeof SOH_ENGINE_DEFAULTS>): void {
    this.config = { ...this.config, ...config };
  }

  private initEKF(cellId: string): void {
    if (!this.ekfState.has(cellId)) {
      this.ekfState.set(cellId, {
        x: 100,
        P: 1,
        Q: 0.001,
        R: 0.1
      });
    }
  }

  private estimateICA(voltageCurve: number[], temperature: number): { soh: number; confidence: [number, number] } {
    if (voltageCurve.length < 20) {
      return { soh: 96 + gaussianRandom(0, 1), confidence: [93, 99] };
    }

    const dqdv: number[] = [];
    for (let i = 1; i < voltageCurve.length; i++) {
      const dv = voltageCurve[i] - voltageCurve[i - 1];
      if (Math.abs(dv) > 0.001) {
        const dq = 1;
        dqdv.push(dq / dv);
      }
    }

    if (dqdv.length < 5) {
      return { soh: 96 + gaussianRandom(0, 1), confidence: [93, 99] };
    }

    const peakArea = dqdv.reduce((a, b) => a + Math.abs(b), 0) / dqdv.length;
    const nominalPeakArea = 150;
    const tempFactor = 1 - Math.max(0, 25 - temperature) * 0.005;
    let sohEstimate = (peakArea / nominalPeakArea) * 100 * tempFactor;
    sohEstimate = Math.max(60, Math.min(102, sohEstimate + gaussianRandom(0, 0.5)));

    const uncertainty = 1.8 + gaussianRandom(0, 0.3);
    return {
      soh: sohEstimate,
      confidence: [sohEstimate - uncertainty, sohEstimate + uncertainty]
    };
  }

  private estimateEKF(cell: CellData): { soh: number; confidence: [number, number] } {
    this.initEKF(cell.cellId);
    const state = this.ekfState.get(cell.cellId)!;

    state.x += gaussianRandom(0, Math.sqrt(state.Q));

    const ocvVoltage = 2.8 + (cell.soc / 100) * 0.8;
    const voltageError = cell.voltage - ocvVoltage;
    const H = 0.5;
    const K = state.P * H / (H * state.P * H + state.R);
    state.x += K * voltageError;
    state.P = (1 - K * H) * state.P + state.Q;

    let sohEstimate = state.x;
    sohEstimate = Math.max(60, Math.min(102, sohEstimate + gaussianRandom(0, 0.6)));

    const uncertainty = 2.0 + gaussianRandom(0, 0.4);
    return {
      soh: sohEstimate,
      confidence: [sohEstimate - uncertainty, sohEstimate + uncertainty]
    };
  }

  estimateCell(cell: CellData): SOHResult {
    const buffer = this.icaBuffer.get(cell.cellId) || [];
    const voltageCurve = [...buffer, cell.voltage].slice(-100);
    this.icaBuffer.set(cell.cellId, voltageCurve);

    const icaResult = this.estimateICA(voltageCurve, cell.temperature);
    const ekfResult = this.estimateEKF(cell);

    const weightICA = 0.6;
    const weightEKF = 0.4;
    const fusedSoh = icaResult.soh * weightICA + ekfResult.soh * weightEKF;

    const stdDev = calculateStdDev([icaResult.soh, ekfResult.soh]);
    const margin = stdDev * 1.96 + 0.5;
    const confidenceLower = Math.min(icaResult.confidence[0], ekfResult.confidence[0]);
    const confidenceUpper = Math.max(icaResult.confidence[1], ekfResult.confidence[1]);

    const actualSoh = cell.soh;
    const error = fusedSoh - actualSoh;

    return {
      cellId: cell.cellId,
      soh: fusedSoh,
      confidence: [confidenceLower, confidenceUpper],
      error: error,
      method: 'FUSED'
    };
  }

  estimateAllCells(cells: CellData[]): SOHResult[] {
    return cells.map(cell => this.estimateCell(cell));
  }

  getICABuffer(cellId: string): number[] {
    return this.icaBuffer.get(cellId) || [];
  }

  clearBuffers(): void {
    this.icaBuffer.clear();
    this.ekfState.clear();
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
    const within2PercentRate = errors.length > 0 ? (within2Percent / errors.length) * 100 : 0;

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
      maxError,
      mae,
      rmse,
      sohDistribution,
      boxplotStats: { min, q1, median, q3, max, outliers }
    };
  }
}
