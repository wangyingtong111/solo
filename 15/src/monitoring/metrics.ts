class MetricsCollector {
  private counters: Map<string, number> = new Map();
  private timers: Map<string, number[]> = new Map();
  private gauges: Map<string, number> = new Map();
  private histograms: Map<string, { sum: number; count: number; min: number; max: number }> = new Map();

  increment(name: string, labels: Record<string, string> = {}, value: number = 1): void {
    const key = this.buildKey(name, labels);
    this.counters.set(key, (this.counters.get(key) || 0) + value);
  }

  timing(name: string, durationMs: number, labels: Record<string, string> = {}): void {
    const key = this.buildKey(name, labels);
    const bucket = this.timers.get(key) || [];
    bucket.push(durationMs);
    if (bucket.length > 10000) bucket.shift();
    this.timers.set(key, bucket);

    const hist = this.histograms.get(key) || { sum: 0, count: 0, min: Infinity, max: -Infinity };
    hist.sum += durationMs;
    hist.count++;
    hist.min = Math.min(hist.min, durationMs);
    hist.max = Math.max(hist.max, durationMs);
    this.histograms.set(key, hist);
  }

  gauge(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = this.buildKey(name, labels);
    this.gauges.set(key, value);
  }

  getCounters(): Record<string, number> {
    const result: Record<string, number> = {};
    this.counters.forEach((v, k) => { result[k] = v; });
    return result;
  }

  getTimings(): Record<string, { avg: number; p50: number; p95: number; p99: number; min: number; max: number }> {
    const result: Record<string, any> = {};
    this.timers.forEach((values, key) => {
      if (values.length === 0) return;
      const sorted = [...values].sort((a, b) => a - b);
      result[key] = {
        avg: values.reduce((a, b) => a + b, 0) / values.length,
        p50: sorted[Math.floor(sorted.length * 0.5)],
        p95: sorted[Math.floor(sorted.length * 0.95)],
        p99: sorted[Math.floor(sorted.length * 0.99)],
        min: sorted[0],
        max: sorted[sorted.length - 1],
      };
    });
    return result;
  }

  getGauges(): Record<string, number> {
    const result: Record<string, number> = {};
    this.gauges.forEach((v, k) => { result[k] = v; });
    return result;
  }

  getSnapshot(): {
    counters: Record<string, number>;
    timings: Record<string, any>;
    gauges: Record<string, number>;
    timestamp: number;
  } {
    return {
      counters: this.getCounters(),
      timings: this.getTimings(),
      gauges: this.getGauges(),
      timestamp: Date.now(),
    };
  }

  private buildKey(name: string, labels: Record<string, string>): string {
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    return labelStr ? `${name}{${labelStr}}` : name;
  }
}

export const metrics = new MetricsCollector();
