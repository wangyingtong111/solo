"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tracer = void 0;
const uuid_1 = require("uuid");
const logger_1 = require("../utils/logger");
const metrics_1 = require("../monitoring/metrics");
class Tracer {
    activeSpans = new Map();
    completedTraces = new Map();
    maxTraces = 1000;
    startSpan(operation, parentContext, tags) {
        const span = {
            traceId: parentContext?.traceId || (0, uuid_1.v4)(),
            spanId: (0, uuid_1.v4)().substring(0, 8),
            parentSpanId: parentContext?.spanId,
            operation,
            startTime: Date.now(),
            tags: tags || {},
            logs: [],
            status: 'OK',
        };
        this.activeSpans.set(span.spanId, span);
        metrics_1.metrics.increment('trace.span_started', { operation });
        return span;
    }
    finishSpan(span) {
        span.endTime = Date.now();
        const duration = span.endTime - span.startTime;
        this.activeSpans.delete(span.spanId);
        const traces = this.completedTraces.get(span.traceId) || [];
        traces.push(span);
        this.completedTraces.set(span.traceId, traces);
        if (this.completedTraces.size > this.maxTraces) {
            const oldest = this.completedTraces.keys().next().value;
            if (oldest)
                this.completedTraces.delete(oldest);
        }
        metrics_1.metrics.timing('trace.span_duration', duration, { operation: span.operation });
        metrics_1.metrics.increment('trace.span_completed', { operation: span.operation, status: span.status });
        const log = (0, logger_1.createChildLogger)({
            traceId: span.traceId,
            spanId: span.spanId,
            operation: span.operation,
            durationMs: duration,
        });
        if (span.status === 'ERROR') {
            log.error({ tags: span.tags }, 'Span completed with error');
        }
        else {
            log.info({ tags: span.tags }, 'Span completed');
        }
    }
    addLog(span, event, data) {
        span.logs.push({
            timestamp: Date.now(),
            event,
            data,
        });
    }
    setError(span) {
        span.status = 'ERROR';
    }
    getTrace(traceId) {
        return this.completedTraces.get(traceId) || [];
    }
    getActiveSpans() {
        return Array.from(this.activeSpans.values());
    }
    getRecentTraces(count = 20) {
        const results = [];
        let i = 0;
        for (const [traceId, spans] of [...this.completedTraces].reverse()) {
            if (i >= count)
                break;
            const startTimes = spans.map(s => s.startTime).filter(Boolean);
            const endTimes = spans.map(s => s.endTime).filter(Boolean);
            const totalDurationMs = startTimes.length > 0 && endTimes.length > 0
                ? Math.max(...endTimes) - Math.min(...startTimes)
                : 0;
            results.push({ traceId, spans, totalDurationMs });
            i++;
        }
        return results;
    }
    getContext(span) {
        return {
            traceId: span.traceId,
            spanId: span.spanId,
            parentSpanId: span.parentSpanId,
        };
    }
}
exports.tracer = new Tracer();
//# sourceMappingURL=index.js.map