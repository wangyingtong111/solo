import { v4 as uuidv4 } from 'uuid';
import { logger, createChildLogger } from '../utils/logger';
import { metrics } from '../monitoring/metrics';

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  operation: string;
  startTime: number;
  endTime?: number;
  tags: Record<string, string | number>;
  logs: Array<{ timestamp: number; event: string; data?: any }>;
  status: 'OK' | 'ERROR';
}

export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}

class Tracer {
  private activeSpans: Map<string, Span> = new Map();
  private completedTraces: Map<string, Span[]> = new Map();
  private maxTraces: number = 1000;

  startSpan(operation: string, parentContext?: TraceContext, tags?: Record<string, string | number>): Span {
    const span: Span = {
      traceId: parentContext?.traceId || uuidv4(),
      spanId: uuidv4().substring(0, 8),
      parentSpanId: parentContext?.spanId,
      operation,
      startTime: Date.now(),
      tags: tags || {},
      logs: [],
      status: 'OK',
    };

    this.activeSpans.set(span.spanId, span);
    metrics.increment('trace.span_started', { operation });
    return span;
  }

  finishSpan(span: Span): void {
    span.endTime = Date.now();
    const duration = span.endTime - span.startTime;

    this.activeSpans.delete(span.spanId);

    const traces = this.completedTraces.get(span.traceId) || [];
    traces.push(span);
    this.completedTraces.set(span.traceId, traces);

    if (this.completedTraces.size > this.maxTraces) {
      const oldest = this.completedTraces.keys().next().value;
      if (oldest) this.completedTraces.delete(oldest);
    }

    metrics.timing('trace.span_duration', duration, { operation: span.operation });
    metrics.increment('trace.span_completed', { operation: span.operation, status: span.status });

    const log = createChildLogger({
      traceId: span.traceId,
      spanId: span.spanId,
      operation: span.operation,
      durationMs: duration,
    });

    if (span.status === 'ERROR') {
      log.error({ tags: span.tags }, 'Span completed with error');
    } else {
      log.info({ tags: span.tags }, 'Span completed');
    }
  }

  addLog(span: Span, event: string, data?: any): void {
    span.logs.push({
      timestamp: Date.now(),
      event,
      data,
    });
  }

  setError(span: Span): void {
    span.status = 'ERROR';
  }

  getTrace(traceId: string): Span[] {
    return this.completedTraces.get(traceId) || [];
  }

  getActiveSpans(): Span[] {
    return Array.from(this.activeSpans.values());
  }

  getRecentTraces(count: number = 20): Array<{ traceId: string; spans: Span[]; totalDurationMs: number }> {
    const results: Array<{ traceId: string; spans: Span[]; totalDurationMs: number }> = [];
    let i = 0;

    for (const [traceId, spans] of [...this.completedTraces].reverse()) {
      if (i >= count) break;
      const startTimes = spans.map(s => s.startTime).filter(Boolean) as number[];
      const endTimes = spans.map(s => s.endTime).filter(Boolean) as number[];
      const totalDurationMs = startTimes.length > 0 && endTimes.length > 0
        ? Math.max(...endTimes) - Math.min(...startTimes)
        : 0;

      results.push({ traceId, spans, totalDurationMs });
      i++;
    }

    return results;
  }

  getContext(span: Span): TraceContext {
    return {
      traceId: span.traceId,
      spanId: span.spanId,
      parentSpanId: span.parentSpanId,
    };
  }
}

export const tracer = new Tracer();
