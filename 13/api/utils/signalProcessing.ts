export function fft(real: number[], imag: number[]): { real: number[]; imag: number[] } {
  const n = real.length;
  if (n === 1) {
    return { real: [real[0]], imag: [imag[0] || 0] };
  }

  const m = n / 2;
  const evenReal: number[] = [];
  const evenImag: number[] = [];
  const oddReal: number[] = [];
  const oddImag: number[] = [];

  for (let i = 0; i < m; i++) {
    evenReal.push(real[2 * i]);
    evenImag.push(imag[2 * i] || 0);
    oddReal.push(real[2 * i + 1]);
    oddImag.push(imag[2 * i + 1] || 0);
  }

  const even = fft(evenReal, evenImag);
  const odd = fft(oddReal, oddImag);

  const resultReal = new Array(n);
  const resultImag = new Array(n);

  for (let k = 0; k < m; k++) {
    const angle = (-2 * Math.PI * k) / n;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    const tReal = cos * odd.real[k] - sin * odd.imag[k];
    const tImag = sin * odd.real[k] + cos * odd.imag[k];

    resultReal[k] = even.real[k] + tReal;
    resultImag[k] = even.imag[k] + tImag;
    resultReal[k + m] = even.real[k] - tReal;
    resultImag[k + m] = even.imag[k] - tImag;
  }

  return { real: resultReal, imag: resultImag };
}

export function nextPowerOf2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

export function computeSpectrum(signal: number[], sampleRate: number): { magnitudes: number[]; frequencies: number[] } {
  const n = nextPowerOf2(signal.length);
  const padded = new Array(n).fill(0);
  for (let i = 0; i < signal.length; i++) {
    padded[i] = signal[i];
  }

  const imag = new Array(n).fill(0);
  const { real, imag: imagOut } = fft(padded, imag);

  const magnitudes: number[] = [];
  const frequencies: number[] = [];
  const halfN = n / 2;

  for (let i = 0; i <= halfN; i++) {
    const mag = Math.sqrt(real[i] * real[i] + imagOut[i] * imagOut[i]) / n;
    magnitudes.push(mag * 2);
    frequencies.push((i * sampleRate) / n);
  }

  return { magnitudes, frequencies };
}

export function computeKurtosis(signal: number[]): number {
  const n = signal.length;
  if (n < 4) return 0;

  let mean = 0;
  for (let i = 0; i < n; i++) {
    mean += signal[i];
  }
  mean /= n;

  let m2 = 0;
  let m4 = 0;
  for (let i = 0; i < n; i++) {
    const diff = signal[i] - mean;
    const diff2 = diff * diff;
    m2 += diff2;
    m4 += diff2 * diff2;
  }
  m2 /= n;
  m4 /= n;

  if (m2 === 0) return 0;

  return m4 / (m2 * m2);
}

export function computeRMS(signal: number[]): number {
  let sum = 0;
  for (let i = 0; i < signal.length; i++) {
    sum += signal[i] * signal[i];
  }
  return Math.sqrt(sum / signal.length);
}

export function computePeak(signal: number[]): number {
  let max = Math.abs(signal[0]);
  for (let i = 1; i < signal.length; i++) {
    const abs = Math.abs(signal[i]);
    if (abs > max) max = abs;
  }
  return max;
}

export function hilbertTransform(signal: number[]): number[] {
  const n = signal.length;
  const imag = new Array(n).fill(0);
  const { real, imag: imagOut } = fft(signal, imag);

  const h = new Array(n).fill(0);
  if (n % 2 === 0) {
    h[0] = 1;
    h[n / 2] = 1;
    for (let i = 1; i < n / 2; i++) {
      h[i] = 2;
    }
  } else {
    h[0] = 1;
    for (let i = 1; i < (n + 1) / 2; i++) {
      h[i] = 2;
    }
  }

  const analyticReal: number[] = [];
  const analyticImag: number[] = [];
  for (let i = 0; i < n; i++) {
    analyticReal.push(real[i] * h[i]);
    analyticImag.push(imagOut[i] * h[i]);
  }

  const { real: invReal, imag: invImag } = ifft(analyticReal, analyticImag);

  const envelope: number[] = [];
  for (let i = 0; i < n; i++) {
    envelope.push(Math.sqrt(invReal[i] * invReal[i] + invImag[i] * invImag[i]));
  }

  return envelope;
}

function ifft(real: number[], imag: number[]): { real: number[]; imag: number[] } {
  const n = real.length;
  const conjImag = imag.map(x => -x);
  const { real: fwdReal, imag: fwdImag } = fft(real, conjImag);
  return {
    real: fwdReal.map(x => x / n),
    imag: fwdImag.map(x => -x / n)
  };
}

export function envelopeSpectrum(signal: number[], sampleRate: number): { magnitudes: number[]; frequencies: number[] } {
  const envelope = hilbertTransform(signal);
  return computeSpectrum(envelope, sampleRate);
}

export function highPassFilter(signal: number[], sampleRate: number, cutoffFreq: number): number[] {
  const n = signal.length;
  const result = new Array(n);

  const dt = 1 / sampleRate;
  const RC = 1 / (2 * Math.PI * cutoffFreq);
  const alpha = RC / (RC + dt);

  let prevX = signal[0];
  let prevY = 0;

  for (let i = 0; i < n; i++) {
    result[i] = alpha * (prevY + signal[i] - prevX);
    prevY = result[i];
    prevX = signal[i];
  }

  return result;
}

export function extractFeatures(signal: number[], sampleRate: number) {
  const filtered = highPassFilter(signal, sampleRate, 10);
  const kurtosis = computeKurtosis(filtered);
  const peak = computePeak(filtered);
  const rms = computeRMS(filtered);
  const crestFactor = rms > 0 ? peak / rms : 0;
  const { magnitudes: spectrum } = envelopeSpectrum(filtered, sampleRate);
  
  return {
    kurtosis,
    peak,
    rms,
    crestFactor,
    spectrum
  };
}
