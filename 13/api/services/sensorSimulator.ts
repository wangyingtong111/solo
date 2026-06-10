import type { Sensor } from '../../shared/types';

export const SENSORS: Sensor[] = [
  { id: 1, name: 'CH1-驱动端', location: '电机驱动端轴承', status: 'normal', sampleRate: 5000 },
  { id: 2, name: 'CH2-非驱动端', location: '电机非驱动端轴承', status: 'normal', sampleRate: 5000 },
  { id: 3, name: 'CH3-风扇端', location: '风机风扇端', status: 'normal', sampleRate: 5000 },
  { id: 4, name: 'CH4-齿轮箱', location: '齿轮箱输入端', status: 'normal', sampleRate: 5000 },
  { id: 5, name: 'CH5-泵入口', location: '泵入口侧', status: 'normal', sampleRate: 5000 },
  { id: 6, name: 'CH6-泵出口', location: '泵出口侧', status: 'normal', sampleRate: 5000 },
  { id: 7, name: 'CH7-压缩机', location: '压缩机壳体', status: 'normal', sampleRate: 5000 },
  { id: 8, name: 'CH8-电机座', location: '电机底座', status: 'normal', sampleRate: 5000 },
  { id: 9, name: 'CH9-联轴器', location: '联轴器侧', status: 'normal', sampleRate: 5000 },
  { id: 10, name: 'CH10-负载端', location: '负载端', status: 'normal', sampleRate: 5000 },
];

interface SensorSimulatorState {
  phase: number;
  degradationLevel: number;
  faultFrequency: number;
  noiseLevel: number;
  lastKurtosis: number;
  targetKurtosis: number;
}

const sensorStates = new Map<number, SensorSimulatorState>();

export function initSensorStates() {
  for (const sensor of SENSORS) {
    const baseKurtosis = 2.8 + Math.random() * 0.4;
    sensorStates.set(sensor.id, {
      phase: Math.random() * Math.PI * 2,
      degradationLevel: Math.random() * 0.1,
      faultFrequency: 150 + Math.random() * 100,
      noiseLevel: 0.1 + Math.random() * 0.05,
      lastKurtosis: baseKurtosis,
      targetKurtosis: baseKurtosis,
    });
  }
}

export function generateWaveform(sensorId: number, sampleCount: number, sampleRate: number): number[] {
  const state = sensorStates.get(sensorId);
  if (!state) return new Array(sampleCount).fill(0);

  const samples: number[] = [];
  const rotFreq = 50;
  const faultFreq = state.faultFrequency;
  const dt = 1 / sampleRate;

  if (Math.random() < 0.02) {
    const delta = (Math.random() - 0.5) * 1.5;
    state.targetKurtosis = Math.max(2.5, Math.min(6.5, state.targetKurtosis + delta));
  }

  state.lastKurtosis += (state.targetKurtosis - state.lastKurtosis) * 0.01;

  const kurtosisFactor = Math.max(0, (state.lastKurtosis - 2.8) / 3);
  const impactAmplitude = kurtosisFactor * 0.8;
  const impactRate = 1 + kurtosisFactor * 3;

  for (let i = 0; i < sampleCount; i++) {
    const t = state.phase + i * dt;

    let value = 0;

    value += Math.sin(2 * Math.PI * rotFreq * t) * 0.3;
    value += Math.sin(2 * Math.PI * rotFreq * 2 * t) * 0.15;
    value += Math.sin(2 * Math.PI * rotFreq * 3 * t) * 0.08;

    const impactPhase = (t * impactRate) % 1;
    if (impactPhase < 0.02 && impactAmplitude > 0) {
      const impact = Math.sin((impactPhase / 0.02) * Math.PI) * impactAmplitude;
      value += impact * Math.sin(2 * Math.PI * faultFreq * t);
    }

    value += (Math.random() * 2 - 1) * state.noiseLevel;
    value += (Math.random() * 2 - 1) * state.noiseLevel * 0.5;

    samples.push(value);
  }

  state.phase += sampleCount * dt;
  state.phase = state.phase % (2 * Math.PI);

  return samples;
}

export function getSensorKurtosis(sensorId: number): number {
  const state = sensorStates.get(sensorId);
  return state ? state.lastKurtosis : 3.0;
}

export function setFaultLevel(sensorId: number, level: number) {
  const state = sensorStates.get(sensorId);
  if (state) {
    state.targetKurtosis = 2.8 + level * 3.5;
  }
}
