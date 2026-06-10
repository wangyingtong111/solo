import { create } from 'zustand';
import type { FeatureData, AlertData, PredictionData, Sensor } from '../../shared/types';

interface SensorState {
  waveform: number[];
  features: FeatureData | null;
  prediction: PredictionData | null;
  status: 'normal' | 'warning' | 'critical';
}

interface AppState {
  sensors: Sensor[];
  sensorStates: Record<number, SensorState>;
  alerts: AlertData[];
  alertIds: Set<string>;
  kurtosisThreshold: number;
  activeSensorId: number;
  alertModalVisible: boolean;
  latestAlert: AlertData | null;
  wsConnected: boolean;

  setSensors: (sensors: Sensor[]) => void;
  setActiveSensor: (id: number) => void;
  updateWaveform: (sensorId: number, samples: number[]) => void;
  updateFeatures: (features: FeatureData) => void;
  updatePrediction: (prediction: PredictionData) => void;
  addAlert: (alert: AlertData) => void;
  setKurtosisThreshold: (threshold: number) => void;
  setAlertModalVisible: (visible: boolean) => void;
  setWsConnected: (connected: boolean) => void;
}

const initialSensorState: SensorState = {
  waveform: [],
  features: null,
  prediction: null,
  status: 'normal',
};

export const useAppStore = create<AppState>((set, get) => ({
  sensors: [],
  sensorStates: {},
  alerts: [],
  alertIds: new Set<string>(),
  kurtosisThreshold: 3.5,
  activeSensorId: 1,
  alertModalVisible: false,
  latestAlert: null,
  wsConnected: false,

  setSensors: (sensors) => {
    const sensorStates: Record<number, SensorState> = {};
    for (const s of sensors) {
      sensorStates[s.id] = { ...initialSensorState, status: s.status };
    }
    set({ sensors, sensorStates });
  },

  setActiveSensor: (id) => set({ activeSensorId: id }),

  updateWaveform: (sensorId, samples) =>
    set((state) => {
      const prev = state.sensorStates[sensorId] || initialSensorState;
      const combined = [...prev.waveform, ...samples].slice(-5000);
      return {
        sensorStates: {
          ...state.sensorStates,
          [sensorId]: { ...prev, waveform: combined },
        },
      };
    }),

  updateFeatures: (features) =>
    set((state) => {
      const prev = state.sensorStates[features.sensorId] || initialSensorState;
      const status = features.kurtosis > state.kurtosisThreshold * 1.3
        ? 'critical'
        : features.kurtosis > state.kurtosisThreshold
        ? 'warning'
        : 'normal';

      return {
        sensorStates: {
          ...state.sensorStates,
          [features.sensorId]: { ...prev, features, status },
        },
      };
    }),

  updatePrediction: (prediction) =>
    set((state) => {
      const prev = state.sensorStates[prediction.sensorId] || initialSensorState;
      return {
        sensorStates: {
          ...state.sensorStates,
          [prediction.sensorId]: { ...prev, prediction: prediction as unknown as PredictionData },
        },
      };
    }),

  addAlert: (alert) =>
    set((prev) => {
      if (prev.alertIds.has(alert.id)) {
        return prev;
      }
      const newAlertIds = new Set(prev.alertIds);
      newAlertIds.add(alert.id);
      return {
        alerts: [alert, ...prev.alerts].slice(0, 100),
        alertIds: newAlertIds,
        latestAlert: alert,
        alertModalVisible: true,
      };
    }),

  setKurtosisThreshold: (threshold) => set({ kurtosisThreshold: threshold }),

  setAlertModalVisible: (visible) => set({ alertModalVisible: visible }),

  setWsConnected: (connected) => set({ wsConnected: connected }),
}));
