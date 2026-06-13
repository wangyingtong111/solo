import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { inventoryService, DeductRequest } from '../services/inventoryService';
import { transactionManager, TxState } from '../services/transactionManager';
import { mqProducer, MQJobType } from '../mq';
import { dynamicRateLimiter } from '../services/rateLimiter';
import { circuitBreaker } from '../services/degradationService';
import { segmentLockService } from '../services/segmentLock';
import { tracer, TraceContext } from '../tracing';
import { metrics } from '../monitoring/metrics';
import { logger } from '../utils/logger';

interface DeductBody {
  skuId: string;
  merchantId: string;
  orderId: string;
  quantity: number;
}

interface RollbackBody {
  txId: string;
  skuId: string;
  reason?: string;
}

interface ConfirmBody {
  txId: string;
  skuId: string;
  quantity: number;
}

interface InitStockBody {
  skuId: string;
  totalStock: number;
  isHot?: boolean;
  segmentCount?: number;
}

interface SetRateLimitBody {
  merchantId: string;
  limit: number;
  windowMs?: number;
  burstLimit?: number;
}

const traceHeader = 'x-trace-id';
const merchantHeader = 'x-merchant-id';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (req: FastifyRequest) => {
    const traceId = req.headers[traceHeader] as string || '';
    if (!req.headers[traceHeader]) {
      req.headers[traceHeader] = traceId || '';
    }
    metrics.increment('http.request', { method: req.method, path: req.url });
  });

  app.addHook('onResponse', async (req: FastifyRequest, reply: FastifyReply) => {
    metrics.timing('http.response_time', reply.elapsedTime, { method: req.method, path: req.url });
  });

  app.post('/api/v1/inventory/deduct', async (req: FastifyRequest<{ Body: DeductBody }>, reply: FastifyReply) => {
    const span = tracer.startSpan('inventory.deduct', undefined, {
      method: 'POST',
      path: '/api/v1/inventory/deduct',
    });
    const traceContext = tracer.getContext(span);

    try {
      const { skuId, merchantId, orderId, quantity } = req.body;

      if (!skuId || !merchantId || !orderId || !quantity || quantity <= 0) {
        tracer.setError(span);
        tracer.finishSpan(span);
        return reply.status(400).send({ error: 'Invalid request: skuId, merchantId, orderId required, quantity > 0' });
      }

      const rateResult = await dynamicRateLimiter.checkWithBurst(merchantId);
      if (!rateResult.allowed) {
        tracer.addLog(span, 'rate_limited', { merchantId });
        tracer.setError(span);
        tracer.finishSpan(span);
        return reply.status(429).send({
          error: 'Rate limit exceeded',
          retryAfterMs: rateResult.retryAfterMs,
          limit: rateResult.limit,
        });
      }

      const deductReq: DeductRequest = {
        skuId,
        merchantId,
        orderId,
        quantity,
        traceId: traceContext.traceId,
      };

      const result = await circuitBreaker.execute('deduct', async () => {
        return inventoryService.deduct(deductReq);
      });

      if (result.result === 'SUCCESS') {
        const tx = await transactionManager.begin(orderId, skuId, merchantId, quantity);
        await transactionManager.advanceState(tx.txId, TxState.PRE_DEDUCTED);

        await mqProducer.sendAsyncDBPersist({
          txId: result.txId,
          orderId,
          skuId,
          merchantId,
          quantity,
          traceId: result.traceId,
        });

        tracer.addLog(span, 'deduct_success', { txId: result.txId, remaining: result.remainingStock });
      } else {
        tracer.addLog(span, 'deduct_failed', { result: result.result });
        if (result.result !== 'DUPLICATE_REQUEST') {
          tracer.setError(span);
        }
      }

      tracer.finishSpan(span);

      const statusCode = result.result === 'SUCCESS' ? 200
        : result.result === 'DUPLICATE_REQUEST' ? 200
        : result.result === 'INSUFFICIENT_STOCK' ? 409
        : 500;

      return reply.status(statusCode).send({
        result: result.result,
        txId: result.txId,
        remainingStock: result.remainingStock,
        traceId: result.traceId,
        latencyMs: result.latencyMs,
      });
    } catch (err: any) {
      tracer.setError(span);
      tracer.addLog(span, 'error', { message: err.message });
      tracer.finishSpan(span);
      logger.error({ err: err.message }, 'Deduct endpoint error');
      return reply.status(500).send({ error: 'Internal server error', traceId: traceContext.traceId });
    }
  });

  app.post('/api/v1/inventory/rollback', async (req: FastifyRequest<{ Body: RollbackBody }>, reply: FastifyReply) => {
    const span = tracer.startSpan('inventory.rollback');

    try {
      const { txId, skuId, reason } = req.body;

      if (!txId || !skuId) {
        tracer.setError(span);
        tracer.finishSpan(span);
        return reply.status(400).send({ error: 'txId and skuId required' });
      }

      const success = await inventoryService.rollback(txId, skuId, reason);

      if (success) {
        await mqProducer.sendRollback({
          txId,
          skuId,
          reason: reason || 'manual_rollback',
          traceId: traceContext(span).traceId,
        });
      }

      tracer.addLog(span, 'rollback_result', { success });
      tracer.finishSpan(span);

      return reply.send({ success, txId, skuId });
    } catch (err: any) {
      tracer.setError(span);
      tracer.finishSpan(span);
      return reply.status(500).send({ error: err.message });
    }

    function traceContext(s: any): { traceId: string } {
      return { traceId: s.traceId };
    }
  });

  app.post('/api/v1/inventory/confirm', async (req: FastifyRequest<{ Body: ConfirmBody }>, reply: FastifyReply) => {
    const span = tracer.startSpan('inventory.confirm');

    try {
      const { txId, skuId, quantity } = req.body;

      if (!txId || !skuId || !quantity) {
        tracer.setError(span);
        tracer.finishSpan(span);
        return reply.status(400).send({ error: 'txId, skuId, quantity required' });
      }

      const success = await inventoryService.confirm(txId, skuId, quantity);

      if (success) {
        await mqProducer.sendConfirm({
          txId,
          skuId,
          quantity,
          traceId: span.traceId,
        });
      }

      tracer.addLog(span, 'confirm_result', { success });
      tracer.finishSpan(span);

      return reply.send({ success, txId });
    } catch (err: any) {
      tracer.setError(span);
      tracer.finishSpan(span);
      return reply.status(500).send({ error: err.message });
    }
  });

  app.get('/api/v1/inventory/stock/:skuId', async (req: FastifyRequest<{ Params: { skuId: string } }>, reply: FastifyReply) => {
    const { skuId } = req.params;
    const result = await circuitBreaker.getStockWithFallback(skuId);
    return reply.send({
      skuId,
      available: result,
      degraded: circuitBreaker.getState() !== 'CLOSED',
    });
  });

  app.post('/api/v1/inventory/init', async (req: FastifyRequest<{ Body: InitStockBody }>, reply: FastifyReply) => {
    const { skuId, totalStock, isHot, segmentCount } = req.body;

    if (!skuId || totalStock === undefined) {
      return reply.status(400).send({ error: 'skuId and totalStock required' });
    }

    await inventoryService.initStock(skuId, totalStock, isHot, segmentCount);
    return reply.send({ skuId, totalStock, isHot: !!isHot, segmentCount: segmentCount || 1 });
  });

  app.post('/api/v1/rate-limit', async (req: FastifyRequest<{ Body: SetRateLimitBody }>, reply: FastifyReply) => {
    const { merchantId, limit, windowMs, burstLimit } = req.body;

    if (!merchantId || !limit) {
      return reply.status(400).send({ error: 'merchantId and limit required' });
    }

    dynamicRateLimiter.setRule(merchantId, limit, windowMs, burstLimit);
    await dynamicRateLimiter.persistRuleToRedis(merchantId);

    return reply.send({ merchantId, limit, windowMs: windowMs || 60000, burstLimit: burstLimit || Math.floor(limit * 0.5) });
  });

  app.get('/api/v1/rate-limit', async (req: FastifyRequest, reply: FastifyReply) => {
    const rules = dynamicRateLimiter.getAllRules();
    return reply.send({ rules });
  });

  app.get('/api/v1/monitoring/metrics', async (req: FastifyRequest, reply: FastifyReply) => {
    const snapshot = metrics.getSnapshot();
    return reply.send(snapshot);
  });

  app.get('/api/v1/monitoring/traces', async (req: FastifyRequest, reply: FastifyReply) => {
    const count = parseInt((req.query as any).count || '20', 10);
    const traces = tracer.getRecentTraces(count);
    return reply.send({ traces });
  });

  app.get('/api/v1/monitoring/circuit-breaker', async (req: FastifyRequest, reply: FastifyReply) => {
    const stats = circuitBreaker.getStats();
    return reply.send(stats);
  });

  app.get('/health', async (req: FastifyRequest, reply: FastifyReply) => {
    const redisReady = await (async () => {
      try {
        const redis = require('../dal/redis').redisClient;
        return await redis.isReady();
      } catch {
        return false;
      }
    })();

    const status = redisReady ? 'healthy' : 'degraded';
    const statusCode = redisReady ? 200 : 503;

    return reply.status(statusCode).send({
      status,
      timestamp: Date.now(),
      redis: redisReady ? 'connected' : 'disconnected',
      circuitBreaker: circuitBreaker.getState(),
    });
  });
}
