import { computeKurtosis, highPassFilter, extractFeatures } from './api/utils/signalProcessing';
import { initSensorStates, generateWaveform, getSensorKurtosis } from './api/services/sensorSimulator';

const SAMPLE_RATE = 5000;
const FRAME_SIZE = 1024;

initSensorStates();

console.log('=== 峭度计算测试 ===\n');

// 测试1: 正态分布噪声
const normalNoise: number[] = [];
for (let i = 0; i < 10000; i++) {
  let u = 0, v = 0;
  while(u === 0) u = Math.random();
  while(v === 0) v = Math.random();
  normalNoise.push(Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v));
}
const noiseKurtosis = computeKurtosis(normalNoise);
console.log(`测试1 - 正态噪声峭度: ${noiseKurtosis.toFixed(4)} (理论值: 3.0)`);

// 测试2: 纯正弦波
const sineWave: number[] = [];
for (let i = 0; i < 10000; i++) {
  sineWave.push(Math.sin(i * 0.01));
}
const sineKurtosis = computeKurtosis(sineWave);
console.log(`测试2 - 纯正弦波峭度: ${sineKurtosis.toFixed(4)} (理论值: 1.5)`);

// 测试3: 传感器模拟器生成的波形
const sensorWave = generateWaveform(1, FRAME_SIZE, SAMPLE_RATE);
const waveKurtosis = computeKurtosis(sensorWave);
const targetKurtosis = getSensorKurtosis(1);
console.log(`\n测试3 - 传感器原始波形:`);
console.log(`  目标峭度 (模拟器状态): ${targetKurtosis.toFixed(4)}`);
console.log(`  实际计算峭度: ${waveKurtosis.toFixed(4)}`);

// 测试4: 经过高通滤波后的波形
const filtered = highPassFilter(sensorWave, SAMPLE_RATE, 10);
const filteredKurtosis = computeKurtosis(filtered);
console.log(`\n测试4 - 高通滤波后波形:`);
console.log(`  滤波后峭度: ${filteredKurtosis.toFixed(4)}`);

// 测试5: 完整的特征提取
const features = extractFeatures(sensorWave, SAMPLE_RATE);
console.log(`\n测试5 - extractFeatures 结果:`);
console.log(`  峭度: ${features.kurtosis.toFixed(4)}`);
console.log(`  峰值: ${features.peak.toFixed(4)}`);
console.log(`  RMS: ${features.rms.toFixed(4)}`);
console.log(`  峰值因子: ${features.crestFactor.toFixed(4)}`);
console.log(`  频谱长度: ${features.spectrum.length}`);
console.log(`  频谱范围: [${Math.min(...features.spectrum).toFixed(6)}, ${Math.max(...features.spectrum).toFixed(6)}]`);

// 测试6: 检查高通滤波器的 alpha 值
const alpha = 10 / (10 + SAMPLE_RATE / (2 * Math.PI));
console.log(`\n测试6 - 高通滤波器参数:`);
console.log(`  当前 alpha 值: ${alpha.toFixed(6)}`);
console.log(`  (正确的 alpha 应该接近 1 对于低频截止)`);

// 测试7: 验证滤波器输出范围
console.log(`\n测试7 - 信号幅值范围:`);
console.log(`  原始波形: [${Math.min(...sensorWave).toFixed(4)}, ${Math.max(...sensorWave).toFixed(4)}]`);
console.log(`  滤波后波形: [${Math.min(...filtered).toFixed(4)}, ${Math.max(...filtered).toFixed(4)}]`);
