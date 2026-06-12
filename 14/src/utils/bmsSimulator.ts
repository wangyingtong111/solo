import type {
  CellData,
  PackData,
  BalanceCommand,
  AlertRecord,
  SOHHistoryPoint,
  BalanceLogPoint,
  HistoryDataPoint,
} from '../types';
import { calculateMean, gaussianRandom } from './statistics';

export const CELL_COUNT = 200;
export const NOMINAL_VOLTAGE = 3.2;
export const VOLTAGE_MIN = 2.5;
export const VOLTAGE_MAX = 3.65;
export const TEMP_MIN = -20;
export const TEMP_MAX = 65;
export const NOMINAL_CAPACITY = 280;
export const ROWS = 10;
export const COLS = 20;

export class BmsSimulator {
  private cells: CellData[];
  private pack: PackData;
  private cycleCount: number;
  private timeElapsed: number;
  private isCharging: boolean;
  private isBalancing: boolean;
  private chargeStartVoltages: number[];
  private icaVoltageHistory: number[][];

  constructor() {
    this.cycleCount = 0;
    this.timeElapsed = 0;
    this.isCharging = false;
    this.isBalancing = false;
    this.chargeStartVoltages = [];
    this.icaVoltageHistory = [];
    this.cells = [];

    for (let i = 0; i < CELL_COUNT; i++) {
      const row = Math.floor(i / COLS);
      const col = i % COLS;
      const cellId = `R${row + 1}C${col + 1}`;

      const voltage = Math.max(VOLTAGE_MIN, Math.min(VOLTAGE_MAX, gaussianRandom(NOMINAL_VOLTAGE, 0.05)));
      const temperature = Math.max(TEMP_MIN, Math.min(TEMP_MAX, gaussianRandom(25, 5)));
      const soh = Math.max(80, Math.min(100, gaussianRandom(100, 1)));
      const soc = Math.max(0, Math.min(100, ((voltage - VOLTAGE_MIN) / (VOLTAGE_MAX - VOLTAGE_MIN)) * 100));
      const internalResistance = Math.max(0.001, Math.min(0.005, gaussianRandom(0.002, 0.0003)));

      this.cells.push({
        cellId,
        voltage,
        temperature,
        soh,
        soc,
        internalResistance,
        balanceCurrent: 0,
      });

      this.chargeStartVoltages.push(voltage);
      this.icaVoltageHistory.push([]);
    }

    const avgVoltage = calculateMean(this.cells.map(c => c.voltage));
    const avgTemp = calculateMean(this.cells.map(c => c.temperature));
    this.pack = {
      packId: 'PACK-001',
      totalVoltage: avgVoltage * CELL_COUNT,
      totalCurrent: 0,
      power: 0,
      avgTemperature: avgTemp,
      cycleCount: 0,
      timestamp: Date.now(),
    };
  }

  getCells(): CellData[] {
    return [...this.cells];
  }

  getPack(): PackData {
    return { ...this.pack };
  }

  getCellCount(): number {
    return CELL_COUNT;
  }

  setCharging(charging: boolean): void {
    this.isCharging = charging;
    if (charging) {
      this.chargeStartVoltages = this.cells.map(c => c.voltage);
      this.icaVoltageHistory = this.cells.map(() => []);
    }
  }

  setBalancing(balancing: boolean): void {
    this.isBalancing = balancing;
  }

  tick(dt_ms: number, balanceCommands?: BalanceCommand[]): void {
    const dt_h = dt_ms / 3600000;

    const voltages = this.cells.map(c => c.voltage);
    const avgVoltage = calculateMean(voltages);

    for (let i = 0; i < CELL_COUNT; i++) {
      const cell = this.cells[i];
      let dV = 0;

      if (this.isCharging) {
        const current = 50;
        const capAh = NOMINAL_CAPACITY * (cell.soh / 100);
        dV += (current / capAh) * NOMINAL_VOLTAGE * dt_h;
        dV += gaussianRandom(0, 0.0005);
      }

      if (balanceCommands && balanceCommands[i]) {
        const cmd = balanceCommands[i];
        if (cmd && cmd.cellId === cell.cellId) {
          const balanceCurrent = cmd.current * (cmd.direction === 'charge' ? 1 : -1);
          const capAh = NOMINAL_CAPACITY * (cell.soh / 100);
          dV += (balanceCurrent / capAh) * NOMINAL_VOLTAGE * dt_h;
          cell.balanceCurrent = balanceCurrent;
        }
      } else if (this.isBalancing && !balanceCommands) {
        const diff = cell.voltage - avgVoltage;
        if (diff > 0.005) {
          const balanceCurrent = -0.5;
          const capAh = NOMINAL_CAPACITY * (cell.soh / 100);
          dV += (balanceCurrent / capAh) * NOMINAL_VOLTAGE * dt_h;
          cell.balanceCurrent = balanceCurrent;
        } else {
          cell.balanceCurrent = 0;
        }
      } else {
        cell.balanceCurrent = 0;
      }

      cell.voltage = Math.max(VOLTAGE_MIN, Math.min(VOLTAGE_MAX, cell.voltage + dV));

      if (this.isCharging) {
        cell.temperature += gaussianRandom(0, 0.05) * (dt_ms / 1000);
      } else {
        cell.temperature += gaussianRandom(0, 0.02) * (dt_ms / 1000);
      }
      cell.temperature = Math.max(TEMP_MIN, Math.min(TEMP_MAX, cell.temperature));

      cell.soh = Math.max(70, Math.min(100, cell.soh - 0.0005 * (dt_ms / 10000)));

      cell.soc = Math.max(0, Math.min(100, ((cell.voltage - VOLTAGE_MIN) / (VOLTAGE_MAX - VOLTAGE_MIN)) * 100));

      if (this.isCharging) {
        this.icaVoltageHistory[i].push(cell.voltage);
      }
    }

    this.timeElapsed += dt_ms;

    const totalVoltage = this.cells.reduce((sum, c) => sum + c.voltage, 0);
    let totalCurrent = 0;
    if (this.isCharging) {
      totalCurrent = 50;
    } else if (Math.random() < 0.3) {
      totalCurrent = -30;
    }
    const power = totalVoltage * totalCurrent;

    this.pack = {
      packId: 'PACK-001',
      totalVoltage,
      totalCurrent,
      power,
      avgTemperature: calculateMean(this.cells.map(c => c.temperature)),
      cycleCount: this.cycleCount,
      timestamp: Date.now(),
    };

    while (this.timeElapsed >= 10000) {
      this.timeElapsed -= 10000;
      this.cycleCount++;
    }
  }

  generateInitialHistory(days: number = 30): HistoryDataPoint[][] {
    const pointsPerDay = 24 * 60;
    const totalPoints = days * pointsPerDay;
    const baseTime = Date.now() - totalPoints * 60 * 1000;
    const result: HistoryDataPoint[][] = [];

    for (let i = 0; i < CELL_COUNT; i++) {
      const cell = this.cells[i];
      const cellHistory: HistoryDataPoint[] = [];
      let voltage = cell.voltage - 0.1;
      let temperature = cell.temperature;
      let soh = cell.soh + 0.5;
      let capacity = NOMINAL_CAPACITY * (soh / 100);
      let resistance = cell.internalResistance - 0.0001;

      for (let t = 0; t < totalPoints; t++) {
        const decayRate = 0.5 / totalPoints;
        voltage += Math.sin(t / 100) * 0.015;
        voltage = Math.max(VOLTAGE_MIN, Math.min(VOLTAGE_MAX, voltage + gaussianRandom(0, 0.005)));
        temperature = 25 + Math.sin(t / (24 * 60) * 2 * Math.PI) * 3 + gaussianRandom(0, 0.02);
        soh = Math.max(80, Math.min(100, soh - decayRate + gaussianRandom(0, 0.005)));
        capacity = NOMINAL_CAPACITY * (soh / 100) + gaussianRandom(0, 0.2);
        resistance = cell.internalResistance + (t / totalPoints) * 0.0001 + gaussianRandom(0, 0.00005);

        cellHistory.push({
          timestamp: baseTime + t * 60 * 1000,
          cellId: cell.cellId,
          voltage,
          temperature,
          soh,
          capacity,
          resistance,
        });
      }
      result.push(cellHistory);
    }
    return result;
  }

  generateSOHHistory(cycles: number = 500): SOHHistoryPoint[][] {
    const result: SOHHistoryPoint[][] = [];
    const baseTime = Date.now() - cycles * 3600 * 1000;

    for (let i = 0; i < CELL_COUNT; i++) {
      const cell = this.cells[i];
      const cellHistory: SOHHistoryPoint[] = [];
      let actualSoh = 100;

      for (let c = 0; c < cycles; c++) {
        const decayPerCycle = 0.002 + Math.random() * 0.001;
        actualSoh = Math.max(75, actualSoh - decayPerCycle);
        const errorFactor = (Math.random() - 0.5) * 3.6;
        const estimatedSoh = Math.max(70, Math.min(100, actualSoh + errorFactor));
        const error = estimatedSoh - actualSoh;
        const ciLower = estimatedSoh - 1.2;
        const ciUpper = estimatedSoh + 1.2;

        cellHistory.push({
          timestamp: baseTime + c * 3600 * 1000,
          cellId: cell.cellId,
          sohEstimated: estimatedSoh,
          sohActual: actualSoh,
          error,
          confidenceLower: ciLower,
          confidenceUpper: ciUpper,
        });
      }
      result.push(cellHistory);
    }
    return result;
  }

  generateBalanceLogs(duration_min: number = 60): BalanceLogPoint[][] {
    const result: BalanceLogPoint[][] = [];
    const totalPoints = duration_min;
    const baseTime = Date.now() - duration_min * 60 * 1000;

    const initialDeltas: number[] = [];
    for (let i = 0; i < CELL_COUNT; i++) {
      const sign = Math.random() > 0.5 ? 1 : -1;
      initialDeltas.push(sign * (0.02 + Math.random() * 0.03));
    }
    const targetDelta = 0.005;
    const timeConstant = 10;

    for (let i = 0; i < CELL_COUNT; i++) {
      const cell = this.cells[i];
      const cellLogs: BalanceLogPoint[] = [];
      let voltageBefore = NOMINAL_VOLTAGE + initialDeltas[i];
      for (let t = 0; t < totalPoints; t++) {
        const decayFactor = Math.exp(-t / timeConstant);
        const deltaBefore = initialDeltas[i] * decayFactor + targetDelta * (1 - decayFactor);
        const deltaAfter = Math.max(targetDelta * 0.8, deltaBefore * 0.95);
        const voltageAfter = NOMINAL_VOLTAGE + deltaAfter;
        const pwm = Math.max(0, Math.min(1, deltaBefore / 0.05));
        const commandCurrent = deltaBefore > 0.005 ? -0.5 * pwm : 0;

        cellLogs.push({
          timestamp: baseTime + t * 60 * 1000,
          cellId: cell.cellId,
          commandCurrent,
          pwmDuty: pwm,
          voltageBefore,
          voltageAfter,
          deltaBefore,
          deltaAfter,
        });

        voltageBefore = voltageAfter;
      }
      result.push(cellLogs);
    }
    return result;
  }

  generateAlerts(): AlertRecord[] {
    const alerts: AlertRecord[] = [];
    const now = Date.now();

    const alertTypes = [
      { type: 'VOLTAGE_HIGH', level: 'warning', check: (c: CellData) => c.voltage > 3.55, message: (c: CellData) => `电芯${c.cellId} 电压过高: ${c.voltage.toFixed(3)}V` },
      { type: 'VOLTAGE_LOW', level: 'warning', check: (c: CellData) => c.voltage < 2.8, message: (c: CellData) => `电芯${c.cellId} 电压过低: ${c.voltage.toFixed(3)}V` },
      { type: 'VOLTAGE_CRITICAL_HIGH', level: 'critical', check: (c: CellData) => c.voltage > 3.6, message: (c: CellData) => `电芯${c.cellId} 电压严重过高: ${c.voltage.toFixed(3)}V` },
      { type: 'TEMPERATURE_HIGH', level: 'warning', check: (c: CellData) => c.temperature > 50, message: (c: CellData) => `电芯${c.cellId} 温度过高: ${c.temperature.toFixed(1)}°C` },
      { type: 'TEMPERATURE_CRITICAL_HIGH', level: 'critical', check: (c: CellData) => c.temperature > 60, message: (c: CellData) => `电芯${c.cellId} 温度严重过高: ${c.temperature.toFixed(1)}°C` },
      { type: 'SOH_LOW', level: 'warning', check: (c: CellData) => c.soh < 85, message: (c: CellData) => `电芯${c.cellId} SOH过低: ${c.soh.toFixed(2)}%` },
    ];

    for (let i = 0; i < CELL_COUNT; i++) {
      if (alerts.length >= 10) break;
      const cell = this.cells[i];
      for (const alertDef of alertTypes) {
        if (alerts.length >= 10) break;
        if (alertDef.check(cell) && Math.random() < 0.3) {
          alerts.push({
            timestamp: now - Math.floor(Math.random() * 3600000),
            cellId: cell.cellId,
            level: alertDef.level as 'critical' | 'warning' | 'info',
            type: alertDef.type,
            message: alertDef.message(cell),
            acknowledged: Math.random() < 0.2,
          });
        }
      }
    }

    if (alerts.length === 0 || Math.random() < 0.5) {
      const randomCell = this.cells[Math.floor(Math.random() * CELL_COUNT)];
      alerts.push({
        timestamp: now - Math.floor(Math.random() * 3600000),
        cellId: randomCell.cellId,
        level: 'info',
        type: 'INFO',
        message: `电池包正常运行中，循环次数: ${this.cycleCount}`,
        acknowledged: false,
      });
    }

    return alerts;
  }
}
