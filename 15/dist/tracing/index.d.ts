export interface Span {
    traceId: string;
    spanId: string;
    parentSpanId?: string;
    operation: string;
    startTime: number;
    endTime?: number;
    tags: Record<string, string | number>;
    logs: Array<{
        timestamp: number;
        event: string;
        data?: any;
    }>;
    status: 'OK' | 'ERROR';
}
export interface TraceContext {
    traceId: string;
    spanId: string;
    parentSpanId?: string;
}
declare class Tracer {
    private activeSpans;
    private completedTraces;
    private maxTraces;
    startSpan(operation: string, parentContext?: TraceContext, tags?: Record<string, string | number>): Span;
    finishSpan(span: Span): void;
    addLog(span: Span, event: string, data?: any): void;
    setError(span: Span): void;
    getTrace(traceId: string): Span[];
    getActiveSpans(): Span[];
    getRecentTraces(count?: number): Array<{
        traceId: string;
        spans: Span[];
        totalDurationMs: number;
    }>;
    getContext(span: Span): TraceContext;
}
export declare const tracer: Tracer;
export {};
//# sourceMappingURL=index.d.ts.map