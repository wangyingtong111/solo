import type { CellData, BalanceCommand, BalanceConfig } from '../types';

const DEFAULT_CONFIG: BalanceConfig = {
  balanceThreshold: 0.01,
  maxCurrent: 2,
  targetDelta: 0.005,
  kp: 0.8,
  ki: 0.1,
  kd: 0.05
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

    if (delta < this.config.targetDelta) {
      return cells.map(cell => ({
        cellId: cell.cellId,
        current: 0,
        direction: 'discharge' as const,
        pwmDuty: 0
      }));
    }

    const meanV = this.meanVoltage(voltages);
    const meanSoh = sohValues.reduce((a, b) => a + b, 0) / sohValues.length;

    return cells.map((cell, idx) => {
      const vError = cell.voltage - meanV;
      const sohFactor = 1 - (cell.soh - meanSoh) / 100 * 0.5;

      const intKey = cell.cellId;
      const prevInt = this.integralError.get(intKey) || 0;
      const prevErr = this.prevError.get(intKey) || 0;

      const newInt = Math.max(-5, Math.min(5, prevInt + vError * 0.1));
      this.integralError.set(intKey, newInt);
      this.prevError.set(intKey, vError);

      const derivative = (vError - prevErr) / 0.1;

      let pidOutput = this.config.kp * vError + this.config.ki * newInt + this.config.kd * derivative;
      pidOutput *= sohFactor;

      let current = Math.min(this.config.maxCurrent, Math.abs(pidOutput));
      current = Math.max(0, current - this.config.targetDelta * 50);

      if (Math.abs(vError) < this.config.balanceThreshold * 0.3) {
        current = 0;
      }

      return {
        cellId: cell.cellId,
        current: current,
        direction: pidOutput >= 0 ? 'discharge' : 'charge',
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
    const effectiveRatePerSecond = maxCurrent * 0.0005;
    if (effectiveRatePerSecond <= 0) return 30;
    const secondsNeeded = (initialDelta - targetDelta) / effectiveRatePerSecond;
    const minutes = secondsNeeded / 60;
    return Math.min(30, Math.max(0, minutes));
  }

  evaluateConvergence(cells: CellData[]): { timestamps: number[]; deltas: number[]; converged: boolean; convergeTime: number } {
    const timestamps: number[] = [];
    const deltas: number[] = [];
    const startTime = Date.now();
    let currentCells = cells.map(c => ({ ...c }));
    let converged = false;
    let convergeTime = 0;

    const maxSteps = 360;
    for (let step = 0; step < maxSteps; step++) {
      const voltages = currentCells.map(c => c.voltage);
      const delta = this.calculateDelta(voltages);

      timestamps.push(startTime + step * 10000);
      deltas.push(delta);

      if (delta <= this.config.targetDelta) {
        converged = true;
        convergeTime = step * 10;
        break;
      }

      const commands = this.generateCommands(currentCells);
      const meanV = this.meanVoltage(voltages);

      currentCells = currentCells.map((cell, idx) => {
        const cmd = commands[idx];
        const vError = cell.voltage - meanV;
        const balanceEffect = cmd.current * (cmd.direction === 'discharge' ? -1 : 1) * 0.0005 * 10;
        const newVoltage = cell.voltage + balanceEffect + (meanV - cell.voltage) * 0.02;

        return {
          ...cell,
          voltage: newVoltage
        };
      });
    }

    if (!converged) {
      convergeTime = maxSteps * 10;
    }

    return { timestamps, deltas, converged, convergeTime };
  }

  resetState(): void {
    this.integralError.clear();
    this.prevError.clear();
  }
}
