"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.metrics = void 0;
class MetricsCollector {
    counters = new Map();
    timers = new Map();
    gauges = new Map();
    histograms = new Map();
    increment(name, labels = {}, value = 1) {
        const key = this.buildKey(name, labels);
        this.counters.set(key, (this.counters.get(key) || 0) + value);
    }
    timing(name, durationMs, labels = {}) {
        const key = this.buildKey(name, labels);
        const bucket = this.timers.get(key) || [];
        bucket.push(durationMs);
        if (bucket.length > 10000)
            bucket.shift();
        this.timers.set(key, bucket);
        const hist = this.histograms.get(key) || { sum: 0, count: 0, min: Infinity, max: -Infinity };
        hist.sum += durationMs;
        hist.count++;
        hist.min = Math.min(hist.min, durationMs);
        hist.max = Math.max(hist.max, durationMs);
        this.histograms.set(key, hist);
    }
    gauge(name, value, labels = {}) {
        const key = this.buildKey(name, labels);
        this.gauges.set(key, value);
    }
    getCounters() {
        const result = {};
        this.counters.forEach((v, k) => { result[k] = v; });
        return result;
    }
    getTimings() {
        const result = {};
        this.timers.forEach((values, key) => {
            if (values.length === 0)
                return;
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
    getGauges() {
        const result = {};
        this.gauges.forEach((v, k) => { result[k] = v; });
        return result;
    }
    getSnapshot() {
        return {
            counters: this.getCounters(),
            timings: this.getTimings(),
            gauges: this.getGauges(),
            timestamp: Date.now(),
        };
    }
    buildKey(name, labels) {
        const labelStr = Object.entries(labels)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}=${v}`)
            .join(',');
        return labelStr ? `${name}{${labelStr}}` : name;
    }
}
exports.metrics = new MetricsCollector();
//# sourceMappingURL=metrics.js.map