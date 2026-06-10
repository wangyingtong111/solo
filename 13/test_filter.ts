import { highPassFilter, computeSpectrum, computeKurtosis } from './api/utils/signalProcessing.js';

const SAMPLE_RATE = 5000;
const CUTOFF_FREQ = 10;

function testAlpha() {
  const dt = 1 / SAMPLE_RATE;
  const RC = 1 / (2 * Math.PI * CUTOFF_FREQ);
  const alpha = RC / (RC + dt);

  console.log('=== Alpha 值计算 ===');
  console.log(`采样率: ${SAMPLE_RATE} Hz`);
  console.log(`截止频率: ${CUTOFF_FREQ} Hz`);
  console.log(`dt: ${dt.toExponential(4)} s`);
  console.log(`RC: ${RC.toExponential(4)} s`);
  console.log(`alpha: ${alpha.toFixed(6)}`);
  console.log(`alpha ≈ ${alpha.toFixed(3)} (用户要求 ≈0.988)`);
  console.log();
}

function testDCSuppression() {
  const n = 2000;
  const dcSignal = new Array(n).fill(1.0);

  const filtered = highPassFilter(dcSignal, SAMPLE_RATE, CUTOFF_FREQ);

  console.log('=== 直流抑制测试 (输入=1.0) ===');
  console.log(`初始值: filtered[0] = ${filtered[0].toExponential(4)}`);
  console.log(`1/4处: filtered[${n/4}] = ${filtered[Math.floor(n/4)].toExponential(4)}`);
  console.log(`1/2处: filtered[${n/2}] = ${filtered[Math.floor(n/2)].toExponential(4)}`);
  console.log(`3/4处: filtered[${Math.floor(3*n/4)}] = ${filtered[Math.floor(3*n/4)].toExponential(4)}`);
  console.log(`结尾: filtered[${n-1}] = ${filtered[n-1].toExponential(4)}`);
  console.log(`最终值绝对值: ${Math.abs(filtered[n-1]).toExponential(4)}`);
  console.log(`是否趋近于0: ${Math.abs(filtered[n-1]) < 0.01 ? '是' : '否'}`);
  console.log();
}

function testFrequencyResponse() {
  const n = 4096;
  const testFreqs = [1, 5, 10, 20, 50, 100, 500];

  console.log('=== 幅频响应测试 ===');

  for (const freq of testFreqs) {
    const signal = new Array(n).fill(0).map((_, i) => Math.sin(2 * Math.PI * freq * i / SAMPLE_RATE));
    const filtered = highPassFilter(signal, SAMPLE_RATE, CUTOFF_FREQ);

    const inputRMS = Math.sqrt(signal.slice(n/2).reduce((s, x) => s + x*x, 0) / (n/2));
    const outputRMS = Math.sqrt(filtered.slice(n/2).reduce((s, x) => s + x*x, 0) / (n/2));
    const gain = outputRMS / inputRMS;
    const gainDB = 20 * Math.log10(gain);

    console.log(`${freq} Hz: 增益 = ${gain.toFixed(4)} (${gainDB.toFixed(2)} dB)`);
  }
  console.log();
}

function testSinePlusDC() {
  const n = 4096;
  const freq = 50;
  const dcOffset = 2.0;
  const amplitude = 1.0;

  const signal = new Array(n).fill(0).map((_, i) =>
    dcOffset + amplitude * Math.sin(2 * Math.PI * freq * i / SAMPLE_RATE)
  );

  const filtered = highPassFilter(signal, SAMPLE_RATE, CUTOFF_FREQ);

  const outputTail = filtered.slice(n * 3 / 4);
  const outputMean = outputTail.reduce((s, x) => s + x, 0) / outputTail.length;
  const outputPeak = Math.max(...outputTail.map(Math.abs));

  console.log('=== 正弦+直流 测试 ===');
  console.log(`输入: 直流偏置 ${dcOffset}V + ${amplitude}V ${freq}Hz 正弦波`);
  console.log(`输出均值(稳态): ${outputMean.toExponential(4)} (应接近0)`);
  console.log(`输出峰值(稳态): ${outputPeak.toFixed(4)} (应接近${amplitude})`);
  console.log(`直流衰减: ${(1 - Math.abs(outputMean) / dcOffset) * 100}%`);
  console.log();
}

function testStepResponse() {
  const n = 2000;
  const signal = new Array(n).fill(0);
  for (let i = n / 4; i < n; i++) {
    signal[i] = 1.0;
  }

  const filtered = highPassFilter(signal, SAMPLE_RATE, CUTOFF_FREQ);

  console.log('=== 阶跃响应测试 ===');
  console.log(`在 t=n/4 处加单位阶跃`);

  const afterStep = filtered.slice(Math.floor(n/4));
  const peak = Math.max(...afterStep.map(Math.abs));
  const endVal = Math.abs(afterStep[afterStep.length - 1]);

  console.log(`阶跃后峰值: ${peak.toFixed(4)}`);
  console.log(`最终值: ${endVal.toExponential(4)}`);
  console.log();
}

console.log('\n');
testAlpha();
testDCSuppression();
testFrequencyResponse();
testSinePlusDC();
testStepResponse();
console.log('\n');
