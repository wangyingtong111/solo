import type { CellData, BalanceCommand, BalanceConfig } from '../types';

const DEFAULT_CONFIG: BalanceConfig = {
  balanceThreshold: 0.01,
  maxCurrent: 2,
  targetDelta: 0.005,
  kp: 50,
  ki: 3,
  kd: 0.5
};

export class BalanceEngine {
  private config: BalanceConfig;
  private integralError: Map<string, number> = new Map();
  private prevError: Map<string, number> = new Map();

  constructor(config?: Partial<BalanceConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  setConfig(config: Partial<BalanceConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): BalanceConfig {
    return { ...this.config };
  }

  calculateDelta(voltages: number[]): number {
    if (voltages.length === 0) return 0;
    return Math.max(...voltages) - Math.min(...voltages);
  }

  private meanVoltage(voltages: number[]): number {
    return voltages.reduce((a, b) => a + b, 0) / voltages.length;
  }

  generateCommands(cells: CellData[]): BalanceCommand[] {
    const voltages = cells.map(c => c.voltage);
    const sohValues = cells.map(c => c.soh);
    const delta = this.calculateDelta(voltages);

    if (delta < this.config.targetDelta * 0.8) {
      return cells.map(cell => ({
        cellId: cell.cellId,
        current: 0,
        direction: 'discharge' as const,
        pwmDuty: 0
      }));
    }

    const meanV = this.meanVoltage(voltages);
    const meanSoh = sohValues.reduce((a, b) => a + b, 0) / sohValues.length;
    const dt = 0.1;

    return cells.map((cell, idx) => {
      const vError = cell.voltage - meanV;
      const sohFactor = 1 - (cell.soh - meanSoh) / 100 * 0.3;

      const intKey = cell.cellId;
      const prevInt = this.integralError.get(intKey) || 0;
      const prevErr = this.prevError.get(intKey) || 0;

      const newInt = Math.max(-2, Math.min(2, prevInt + vError * dt));
      this.integralError.set(intKey, newInt);
      this.prevError.set(intKey, vError);

      const derivative = (vError - prevErr) / dt;

      let pidOutput = this.config.kp * vError + this.config.ki * newInt + this.config.kd * derivative;
      pidOutput *= sohFactor;

      let current = 0;
      if (vError > this.config.targetDelta * 0.5) {
        current = Math.min(this.config.maxCurrent, Math.max(0, pidOutput));
        const deadBand = this.config.targetDelta * 15;
        current = Math.max(0, current - deadBand);
      }

      if (Math.abs(vError) < this.config.balanceThreshold * 0.1) {
        current = 0;
      }

      return {
        cellId: cell.cellId,
        current: current,
        direction: current > 0 ? 'discharge' : 'charge',
        pwmDuty: current > 0 ? (current / this.config.maxCurrent) * 100 : 0
      };
    });
  }

  estimateConvergenceTime(initialDelta: number, targetDeltaOrMaxCurrent?: number, maxCurrentArg?: number): number {
    let targetDelta: number;
    let maxCurrent: number;

    if (maxCurrentArg !== undefined) {
      targetDelta = targetDeltaOrMaxCurrent !== undefined ? targetDeltaOrMaxCurrent : 0.005;
      maxCurrent = maxCurrentArg;
    } else if (targetDeltaOrMaxCurrent !== undefined) {
      if (targetDeltaOrMaxCurrent < 0.1) {
        targetDelta = targetDeltaOrMaxCurrent;
        maxCurrent = this.config.maxCurrent;
      } else {
        targetDelta = 0.005;
        maxCurrent = targetDeltaOrMaxCurrent;
      }
    } else {
      targetDelta = 0.005;
      maxCurrent = this.config.maxCurrent;
    }

    if (initialDelta <= targetDelta) return 0;

    const voltsPerAmpSecond = 6.0e-5;
    const effectiveKpRatio = 0.7;

    const deadBandCurrent = this.config.targetDelta * 15;
    const currentPerVolt = this.config.kp * effectiveKpRatio;
    const deadBandVoltage = (deadBandCurrent / currentPerVolt) * 2;

    const adjustedInitial = Math.max(0.001, initialDelta - deadBandVoltage);
    const adjustedTarget = Math.max(0.0001, targetDelta - deadBandVoltage);

    if (adjustedInitial <= adjustedTarget) {
      return Math.min(30, Math.max(0, initialDelta / (currentPerVolt * voltsPerAmpSecond * maxCurrent) / 60));
    }

    const tauSeconds = 2 / (currentPerVolt * voltsPerAmpSecond * maxCurrent / adjustedInitial) * (adjustedInitial / 2);
    const tSeconds = tauSeconds * Math.log(adjustedInitial / adjustedTarget);

    return Math.min(30, Math.max(0, tSeconds / 60));
  }

  evaluateConvergence(cells: CellData[]): { timestamps: number[]; deltas: number[]; converged: boolean; convergeTime: number } {
    const timestamps: number[] = [];
    const deltas: number[] = [];
    const startTime = Date.now();
    let currentCells = cells.map(c => ({ ...c }));
    let converged = false;
    let convergeTime = 0;

    const dtSeconds = 5;
    const totalSimulationSeconds = 30 * 60;
    const maxSteps = Math.floor(totalSimulationSeconds / dtSeconds);

    const voltsPerAmpSecond = 6.0e-5;

    const simIntegral: Map<string, number> = new Map();
    const simPrevError: Map<string, number> = new Map();

    const voltages = currentCells.map(c => c.voltage);
    const meanSoh = currentCells.reduce((a, c) => a + c.soh, 0) / currentCells.length;
    const initialDelta = this.calculateDelta(voltages);

    if (initialDelta <= this.config.targetDelta) {
      return {
        timestamps: [startTime],
        deltas: [initialDelta],
        converged: true,
        convergeTime: 0
      };
    }

    for (let step = 0; step < maxSteps; step++) {
      const stepVoltages = currentCells.map(c => c.voltage);
      const delta = this.calculateDelta(stepVoltages);

      timestamps.push(startTime + step * dtSeconds * 1000);
      deltas.push(delta);

      if (delta <= this.config.targetDelta) {
        converged = true;
        convergeTime = step * dtSeconds / 60;
        break;
      }

      const meanV = this.meanVoltage(stepVoltages);

      currentCells = currentCells.map((cell) => {
        const vError = cell.voltage - meanV;
        const sohFactor = 1 - (cell.soh - meanSoh) / 100 * 0.3;

        const intKey = cell.cellId;
        const prevInt = simIntegral.get(intKey) || 0;
        const prevErr = simPrevError.get(intKey) || 0;

        const newInt = Math.max(-2, Math.min(2, prevInt + vError * dtSeconds));
        simIntegral.set(intKey, newInt);
        simPrevError.set(intKey, vError);

        const derivative = (vError - prevErr) / dtSeconds;

        let pidOutput = this.config.kp * vError + this.config.ki * newInt + this.config.kd * derivative;
        pidOutput *= sohFactor;

        let commandCurrent = 0;
        if (vError > this.config.targetDelta * 0.5) {
          commandCurrent = Math.min(this.config.maxCurrent, Math.max(0, pidOutput));
          const deadBand = this.config.targetDelta * 15;
          commandCurrent = Math.max(0, commandCurrent - deadBand);
        }

        if (Math.abs(vError) < this.config.balanceThreshold * 0.1) {
          commandCurrent = 0;
        }

        const dV = -commandCurrent * voltsPerAmpSecond * dtSeconds;
        const newVoltage = cell.voltage + dV;

        return {
          ...cell,
          voltage: newVoltage
        };
      });
    }

    if (!converged) {
      const finalVoltages = currentCells.map(c => c.voltage);
      const finalDelta = this.calculateDelta(finalVoltages);
      if (deltas.length < maxSteps) {
        timestamps.push(startTime + maxSteps * dtSeconds * 1000);
        deltas.push(finalDelta);
      }
      convergeTime = 30;
    }

    return { timestamps, deltas, converged, convergeTime };
  }

  resetState(): void {
    this.integralError.clear();
    this.prevError.clear();
  }
}
