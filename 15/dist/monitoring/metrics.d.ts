declare class MetricsCollector {
    private counters;
    private timers;
    private gauges;
    private histograms;
    increment(name: string, labels?: Record<string, string>, value?: number): void;
    timing(name: string, durationMs: number, labels?: Record<string, string>): void;
    gauge(name: string, value: number, labels?: Record<string, string>): void;
    getCounters(): Record<string, number>;
    getTimings(): Record<string, {
        avg: number;
        p50: number;
        p95: number;
        p99: number;
        min: number;
        max: number;
    }>;
    getGauges(): Record<string, number>;
    getSnapshot(): {
        counters: Record<string, number>;
        timings: Record<string, any>;
        gauges: Record<string, number>;
        timestamp: number;
    };
    private buildKey;
}
export declare const metrics: MetricsCollector;
export {};
//# sourceMappingURL=metrics.d.ts.map