export interface CellData {
  cellId: string;
  voltage: number;
  temperature: number;
  soh: number;
  soc: number;
  internalResistance: number;
  balanceCurrent: number;
}

export interface PackData {
  packId: string;
  totalVoltage: number;
  totalCurrent: number;
  power: number;
  avgTemperature: number;
  cycleCount: number;
  timestamp: number;
}

export interface SOHResult {
  cellId: string;
  soh: number;
  confidence: [number, number];
  error: number;
  method: 'ICA' | 'EKF' | 'FUSED';
}

export interface BalanceCommand {
  cellId: string;
  current: number;
  direction: 'charge' | 'discharge';
  pwmDuty: number;
}

export interface BalanceConfig {
  balanceThreshold: number;
  maxCurrent: number;
  targetDelta: number;
  kp: number;
  ki: number;
  kd: number;
}

export interface AlertRecord {
  timestamp: number;
  cellId: string;
  level: 'critical' | 'warning' | 'info';
  type: string;
  message: string;
  acknowledged: boolean;
}

export interface SOHHistoryPoint {
  timestamp: number;
  cellId: string;
  sohEstimated: number;
  sohActual: number;
  error: number;
  confidenceLower: number;
  confidenceUpper: number;
}

export interface BalanceLogPoint {
  timestamp: number;
  cellId: string;
  commandCurrent: number;
  pwmDuty: number;
  voltageBefore: number;
  voltageAfter: number;
  deltaBefore: number;
  deltaAfter: number;
}

export interface HistoryDataPoint {
  timestamp: number;
  cellId: string;
  voltage: number;
  temperature: number;
  soh: number;
  capacity: number;
  resistance: number;
}

export interface ConfidenceInterval {
  mean: number;
  lower95: number;
  upper95: number;
  standardDeviation: number;
  sampleSize: number;
}

export interface ReportConfig {
  type: 'SOH' | 'BALANCE' | 'DECAY';
  startDate: number;
  endDate: number;
  includeConfidence: boolean;
  format: 'xlsx' | 'csv';
}
