import { highPassFilter } from './api/utils/signalProcessing.js';

const SAMPLE_RATE = 5000;
const CUTOFF_FREQ = 10;

function generateSineWave(freq: number, duration: number, sampleRate: number): number[] {
  const n = Math.floor(duration * sampleRate);
  const signal = new Array(n);
  for (let i = 0; i < n; i++) {
    signal[i] = Math.sin(2 * Math.PI * freq * i / sampleRate);
  }
  return signal;
}

function measureGain(signal: number[], filtered: number[], skipStart: number = 0.5): number {
  const startIdx = Math.floor(skipStart * signal.length);
  const inputTail = signal.slice(startIdx);
  const outputTail = filtered.slice(startIdx);
  
  let inputPeak = 0;
  let outputPeak = 0;
  for (let i = 0; i < inputTail.length; i++) {
    if (Math.abs(inputTail[i]) > inputPeak) inputPeak = Math.abs(inputTail[i]);
    if (Math.abs(outputTail[i]) > outputPeak) outputPeak = Math.abs(outputTail[i]);
  }
  
  return outputPeak / inputPeak;
}

function testSineWaveResponse() {
  const testFreqs = [0.5, 1, 2, 5, 8, 10, 12, 15, 20, 50, 100, 500, 1000, 2000];
  
  console.log('=== 正弦波增益测试 ===');
  console.log('频率\t增益\t\t增益(dB)');
  console.log('----------------------------------------');
  
  for (const freq of testFreqs) {
    const signal = generateSineWave(freq, 2.0, SAMPLE_RATE);
    const filtered = highPassFilter(signal, SAMPLE_RATE, CUTOFF_FREQ);
    const gain = measureGain(signal, filtered, 0.5);
    const gainDB = 20 * Math.log10(gain);
    
    const marker = Math.abs(freq - CUTOFF_FREQ) < 0.5 ? '  ← 截止频率' : '';
    console.log(`${freq} Hz\t${gain.toFixed(6)}\t${gainDB >= 0 ? ' ' : ''}${gainDB.toFixed(3)} dB${marker}`);
  }
  console.log();
}

function testStepResponseDetailed() {
  const n = 1000;
  const signal = new Array(n).fill(0);
  for (let i = 100; i < n; i++) signal[i] = 1.0;
  
  const filtered = highPassFilter(signal, SAMPLE_RATE, CUTOFF_FREQ);
  
  console.log('=== 阶跃响应详细分析 ===');
  console.log('理想高通滤波器阶跃响应：正脉冲，峰值≈1，指数衰减到0');
  console.log();
  
  let peakVal = 0;
  let peakIdx = 0;
  for (let i = 100; i < n; i++) {
    if (Math.abs(filtered[i]) > peakVal) {
      peakVal = Math.abs(filtered[i]);
      peakIdx = i;
    }
  }
  
  console.log(`峰值: ${peakVal.toFixed(6)} (位置: ${peakIdx}, 阶跃后 ${peakIdx - 100} 个采样)`);
  
  const decayTimes = [0.5, 0.1, 0.01];
  for (const target of decayTimes) {
    let decayIdx = -1;
    for (let i = peakIdx; i < n; i++) {
      if (Math.abs(filtered[i]) < peakVal * target) {
        decayIdx = i;
        break;
      }
    }
    if (decayIdx >= 0) {
      const time = (decayIdx - peakIdx) / SAMPLE_RATE * 1000;
      console.log(`衰减到 ${(target*100).toFixed(0)}% 峰值: ${time.toFixed(1)} ms (${decayIdx - peakIdx} 采样)`);
    }
  }
  
  console.log();
  console.log('前10个采样点输出:');
  for (let i = 100; i < 115 && i < n; i++) {
    console.log(`  i=${i}: ${filtered[i].toFixed(6)}`);
  }
  console.log();
}

function testDCStepResponse() {
  const n = 2000;
  const signal = new Array(n).fill(0);
  for (let i = 200; i < n; i++) signal[i] = 2.5;
  
  const filtered = highPassFilter(signal, SAMPLE_RATE, CUTOFF_FREQ);
  
  console.log('=== 直流阶跃响应 (0→2.5V) ===');
  
  let peakVal = 0;
  let peakIdx = 0;
  for (let i = 200; i < n; i++) {
    if (Math.abs(filtered[i]) > peakVal) {
      peakVal = Math.abs(filtered[i]);
      peakIdx = i;
    }
  }
  
  console.log(`峰值: ${peakVal.toFixed(6)}`);
  console.log(`稳态值 (最后100点平均): ${filtered.slice(-100).reduce((a,b)=>a+b,0)/100 .toExponential(4)}`);
  console.log();
  
  if (peakVal > 0.1) {
    console.log('✓ 直流阶跃有明显响应，滤波器能感知直流变化');
  } else {
    console.log('✗ 直流阶跃响应很小，可能有问题');
  }
  console.log();
}

function testInitialConditions() {
  console.log('=== 初始条件影响分析 ===');
  
  const n = 100;
  const signal = new Array(n);
  for (let i = 0; i < n; i++) {
    signal[i] = 1.0 + Math.sin(2 * Math.PI * 50 * i / SAMPLE_RATE);
  }
  
  const filtered = highPassFilter(signal, SAMPLE_RATE, CUTOFF_FREQ);
  
  console.log('输入: 1.0V直流 + 50Hz正弦波(幅度1)');
  console.log(`输入直流偏置: 1.0`);
  console.log(`输出前5点: ${filtered.slice(0, 5).map(x => x.toFixed(6)).join(', ')}`);
  console.log(`输出第50点: ${filtered[50].toFixed(6)}`);
  console.log(`输出最后10点平均: ${filtered.slice(-10).reduce((a,b)=>a+b,0)/10 .toFixed(6)}`);
  console.log();
  
  const outputTail = filtered.slice(50);
  let outputMax = 0;
  let outputMin = Infinity;
  for (const v of outputTail) {
    if (v > outputMax) outputMax = v;
    if (v < outputMin) outputMin = v;
  }
  const outputAC = (outputMax - outputMin) / 2;
  console.log(`输出交流幅度: ${outputAC.toFixed(6)} (理论值约 1.0)`);
  console.log();
}

console.log('\n');
testSineWaveResponse();
testStepResponseDetailed();
testDCStepResponse();
testInitialConditions();
console.log('\n');
