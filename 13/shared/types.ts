export interface Sensor {
  id: number;
  name: string;
  location: string;
  status: 'normal' | 'warning' | 'critical';
  sampleRate: number;
}

export interface WaveformData {
  type: 'waveform';
  timestamp: number;
  sensorId: number;
  samples: number[];
}

export interface FeatureData {
  type: 'features';
  timestamp: number;
  sensorId: number;
  kurtosis: number;
  peak: number;
  rms: number;
  crestFactor: number;
  spectrum: number[];
}

export interface AlertData {
  type: 'alert';
  id: string;
  timestamp: number;
  sensorId: number;
  level: 'warning' | 'critical';
  kurtosis: number;
  threshold: number;
  message: string;
}

export interface TrendPoint {
  time: number;
  health: number;
  upper: number;
  lower: number;
}

export interface PredictionInterval {
  upperBound: number;
  lowerBound: number;
  rulUncertainty: number;
}

export interface PredictionData {
  type: 'prediction';
  sensorId: number;
  rul: number;
  healthIndex: number;
  confidence: number;
  trend: TrendPoint[];
  errorAt70pct: number;
  fitR2?: number;
  degradationMode?: 'exponential' | 'linear' | 'power';
  predictionInterval?: PredictionInterval;
}

export type ServerMessage = WaveformData | FeatureData | AlertData | PredictionData;

export interface ClientMessage {
  type: 'subscribe' | 'unsubscribe' | 'config';
  sensorIds?: number[];
  sampleRate?: number;
  kurtosisThreshold?: number;
}
