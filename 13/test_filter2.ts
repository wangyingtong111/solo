import { highPassFilter, computeSpectrum } from './api/utils/signalProcessing.js';

const SAMPLE_RATE = 5000;
const CUTOFF_FREQ = 10;

function calcAlpha() {
  const dt = 1 / SAMPLE_RATE;
  const RC = 1 / (2 * Math.PI * CUTOFF_FREQ);
  const alpha_backward = RC / (RC + dt);
  const alpha_forward = 1 - dt / RC;
  const alpha_bilinear = (2 * RC / dt - 1) / (2 * RC / dt + 1);

  console.log('=== 三种离散化方法的 alpha 值 ===');
  console.log(`采样率: ${SAMPLE_RATE} Hz, 截止频率: ${CUTOFF_FREQ} Hz`);
  console.log(`dt = ${dt.toExponential(4)} s`);
  console.log(`RC = ${RC.toExponential(4)} s`);
  console.log();
  console.log(`向后欧拉法: alpha = ${alpha_backward.toFixed(6)} ≈ ${alpha_backward.toFixed(3)}`);
  console.log(`向前欧拉法: alpha = ${alpha_forward.toFixed(6)} ≈ ${alpha_forward.toFixed(3)}`);
  console.log(`双线性变换: alpha = ${alpha_bilinear.toFixed(6)} ≈ ${alpha_bilinear.toFixed(3)}`);
  console.log();
}

function testStepResponse() {
  const n = 500;
  const signal = new Array(n).fill(0);
  for (let i = 50; i < n; i++) signal[i] = 1.0;

  const filtered = highPassFilter(signal, SAMPLE_RATE, CUTOFF_FREQ);

  console.log('=== 阶跃响应测试 (t=50 处加单位阶跃) ===');
  console.log('理想高通: 输出应为正脉冲，然后指数衰减到 0');
  console.log();

  let peakVal = 0;
  let peakIdx = 0;
  for (let i = 50; i < n; i++) {
    if (Math.abs(filtered[i]) > peakVal) {
      peakVal = Math.abs(filtered[i]);
      peakIdx = i;
    }
  }

  console.log(`峰值: ${peakVal.toFixed(6)} (位置: ${peakIdx})`);
  console.log(`阶跃后第1点 (i=50): ${filtered[50].toFixed(6)}`);
  console.log(`阶跃后第5点 (i=55): ${filtered[55].toFixed(6)}`);
  console.log(`阶跃后第10点 (i=60): ${filtered[60].toFixed(6)}`);
  console.log(`阶跃后第50点 (i=100): ${filtered[100].toExponential(4)}`);
  console.log(`末尾 (i=499): ${filtered[499].toExponential(4)}`);
  console.log();

  if (filtered[50] === 0) {
    console.log('⚠️  问题: 阶跃后第1点输出为0，初始瞬态不正确');
    console.log('   原因: prevX 被初始化为 signal[0]，导致第一个差分为0');
  }
  console.log();
}

function testDCSuppression() {
  const n = 2000;
  const dcSignal = new Array(n).fill(2.5);

  const filtered = highPassFilter(dcSignal, SAMPLE_RATE, CUTOFF_FREQ);

  console.log('=== 直流信号测试 (输入=2.5 恒定) ===');

  let allZero = true;
  for (let i = 0; i < n; i++) {
    if (Math.abs(filtered[i]) > 1e-10) {
      allZero = false;
      break;
    }
  }

  if (allZero) {
    console.log('输出全为 0');
    console.log('⚠️  注意: 这是因为 prevX=signal[0]，假设直流信号一直存在');
    console.log('   实际物理系统中，加上直流后应有瞬态响应');
  } else {
    console.log(`输出最大值: ${Math.max(...filtered.map(Math.abs)).toExponential(4)}`);
  }
  console.log();
}

function testHighFreqGain() {
  const n = 4096;
  const testFreqs = [50, 100, 500, 1000, 2000];

  console.log('=== 高频增益测试 (理想值=1.0) ===');

  for (const freq of testFreqs) {
    const signal = new Array(n).fill(0).map((_, i) =>
      Math.sin(2 * Math.PI * freq * i / SAMPLE_RATE)
    );
    const filtered = highPassFilter(signal, SAMPLE_RATE, CUTOFF_FREQ);

    const tail = filtered.slice(n / 2);
    const inputRMS = Math.sqrt(signal.slice(n / 2).reduce((s, x) => s + x * x, 0) / (n / 2));
    const outputRMS = Math.sqrt(tail.reduce((s, x) => s + x * x, 0) / tail.length);
    const gain = outputRMS / inputRMS;

    console.log(`${freq} Hz: 增益 = ${gain.toFixed(6)} (${(20 * Math.log10(gain)).toFixed(3)} dB)`);
  }
  console.log();
}

function testCutoffFreq() {
  const n = 8192;
  const { magnitudes, frequencies } = computeSpectrum(
    new Array(n).fill(0).map(() => (Math.random() - 0.5) * 2),
    SAMPLE_RATE
  );

  const filtered = highPassFilter(
    new Array(n).fill(0).map(() => (Math.random() - 0.5) * 2),
    SAMPLE_RATE,
    CUTOFF_FREQ
  );
  const { magnitudes: filteredMag } = computeSpectrum(filtered, SAMPLE_RATE);

  console.log('=== 截止频率验证 ===');
  for (let i = 0; i < frequencies.length; i++) {
    const f = frequencies[i];
    if (f > 0.5 && f < 50 && Math.abs(f - Math.round(f)) < 0.5) {
      const gain = filteredMag[i] / magnitudes[i];
      const gainDB = 20 * Math.log10(gain);
      if (Math.abs(f - CUTOFF_FREQ) < 1) {
        console.log(`*${f.toFixed(1)} Hz: ${gainDB.toFixed(2)} dB  ← 截止频率附近`);
      } else if (f % 5 < 1) {
        console.log(` ${f.toFixed(1)} Hz: ${gainDB.toFixed(2)} dB`);
      }
    }
  }
  console.log('理想截止频率处应为 -3.01 dB');
  console.log();
}

console.log('\n');
calcAlpha();
testStepResponse();
testDCSuppression();
testHighFreqGain();
testCutoffFreq();
console.log('\n');
