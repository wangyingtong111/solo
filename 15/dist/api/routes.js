"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerRoutes = registerRoutes;
const inventoryService_1 = require("../services/inventoryService");
const transactionManager_1 = require("../services/transactionManager");
const mq_1 = require("../mq");
const rateLimiter_1 = require("../services/rateLimiter");
const degradationService_1 = require("../services/degradationService");
const tracing_1 = require("../tracing");
const metrics_1 = require("../monitoring/metrics");
const logger_1 = require("../utils/logger");
const traceHeader = 'x-trace-id';
const merchantHeader = 'x-merchant-id';
async function registerRoutes(app) {
    app.addHook('onRequest', async (req) => {
        const traceId = req.headers[traceHeader] || '';
        if (!req.headers[traceHeader]) {
            req.headers[traceHeader] = traceId || '';
        }
        metrics_1.metrics.increment('http.request', { method: req.method, path: req.url });
    });
    app.addHook('onResponse', async (req, reply) => {
        metrics_1.metrics.timing('http.response_time', reply.elapsedTime, { method: req.method, path: req.url });
    });
    app.post('/api/v1/inventory/deduct', async (req, reply) => {
        const span = tracing_1.tracer.startSpan('inventory.deduct', undefined, {
            method: 'POST',
            path: '/api/v1/inventory/deduct',
        });
        const traceContext = tracing_1.tracer.getContext(span);
        try {
            const { skuId, merchantId, orderId, quantity } = req.body;
            if (!skuId || !merchantId || !orderId || !quantity || quantity <= 0) {
                tracing_1.tracer.setError(span);
                tracing_1.tracer.finishSpan(span);
                return reply.status(400).send({ error: 'Invalid request: skuId, merchantId, orderId required, quantity > 0' });
            }
            const rateResult = await rateLimiter_1.dynamicRateLimiter.checkWithBurst(merchantId);
            if (!rateResult.allowed) {
                tracing_1.tracer.addLog(span, 'rate_limited', { merchantId });
                tracing_1.tracer.setError(span);
                tracing_1.tracer.finishSpan(span);
                return reply.status(429).send({
                    error: 'Rate limit exceeded',
                    retryAfterMs: rateResult.retryAfterMs,
                    limit: rateResult.limit,
                });
            }
            const deductReq = {
                skuId,
                merchantId,
                orderId,
                quantity,
                traceId: traceContext.traceId,
            };
            const result = await degradationService_1.circuitBreaker.execute('deduct', async () => {
                return inventoryService_1.inventoryService.deduct(deductReq);
            });
            if (result.result === 'SUCCESS') {
                const tx = await transactionManager_1.transactionManager.begin(orderId, skuId, merchantId, quantity);
                await transactionManager_1.transactionManager.advanceState(tx.txId, transactionManager_1.TxState.PRE_DEDUCTED);
                await mq_1.mqProducer.sendAsyncDBPersist({
                    txId: result.txId,
                    orderId,
                    skuId,
                    merchantId,
                    quantity,
                    traceId: result.traceId,
                });
                tracing_1.tracer.addLog(span, 'deduct_success', { txId: result.txId, remaining: result.remainingStock });
            }
            else {
                tracing_1.tracer.addLog(span, 'deduct_failed', { result: result.result });
                if (result.result !== 'DUPLICATE_REQUEST') {
                    tracing_1.tracer.setError(span);
                }
            }
            tracing_1.tracer.finishSpan(span);
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
        }
        catch (err) {
            tracing_1.tracer.setError(span);
            tracing_1.tracer.addLog(span, 'error', { message: err.message });
            tracing_1.tracer.finishSpan(span);
            logger_1.logger.error({ err: err.message }, 'Deduct endpoint error');
            return reply.status(500).send({ error: 'Internal server error', traceId: traceContext.traceId });
        }
    });
    app.post('/api/v1/inventory/rollback', async (req, reply) => {
        const span = tracing_1.tracer.startSpan('inventory.rollback');
        try {
            const { txId, skuId, reason } = req.body;
            if (!txId || !skuId) {
                tracing_1.tracer.setError(span);
                tracing_1.tracer.finishSpan(span);
                return reply.status(400).send({ error: 'txId and skuId required' });
            }
            const success = await inventoryService_1.inventoryService.rollback(txId, skuId, reason);
            if (success) {
                await mq_1.mqProducer.sendRollback({
                    txId,
                    skuId,
                    reason: reason || 'manual_rollback',
                    traceId: traceContext(span).traceId,
                });
            }
            tracing_1.tracer.addLog(span, 'rollback_result', { success });
            tracing_1.tracer.finishSpan(span);
            return reply.send({ success, txId, skuId });
        }
        catch (err) {
            tracing_1.tracer.setError(span);
            tracing_1.tracer.finishSpan(span);
            return reply.status(500).send({ error: err.message });
        }
        function traceContext(s) {
            return { traceId: s.traceId };
        }
    });
    app.post('/api/v1/inventory/confirm', async (req, reply) => {
        const span = tracing_1.tracer.startSpan('inventory.confirm');
        try {
            const { txId, skuId, quantity } = req.body;
            if (!txId || !skuId || !quantity) {
                tracing_1.tracer.setError(span);
                tracing_1.tracer.finishSpan(span);
                return reply.status(400).send({ error: 'txId, skuId, quantity required' });
            }
            const success = await inventoryService_1.inventoryService.confirm(txId, skuId, quantity);
            if (success) {
                await mq_1.mqProducer.sendConfirm({
                    txId,
                    skuId,
                    quantity,
                    traceId: span.traceId,
                });
            }
            tracing_1.tracer.addLog(span, 'confirm_result', { success });
            tracing_1.tracer.finishSpan(span);
            return reply.send({ success, txId });
        }
        catch (err) {
            tracing_1.tracer.setError(span);
            tracing_1.tracer.finishSpan(span);
            return reply.status(500).send({ error: err.message });
        }
    });
    app.get('/api/v1/inventory/stock/:skuId', async (req, reply) => {
        const { skuId } = req.params;
        const result = await degradationService_1.circuitBreaker.getStockWithFallback(skuId);
        return reply.send({
            skuId,
            available: result,
            degraded: degradationService_1.circuitBreaker.getState() !== 'CLOSED',
        });
    });
    app.post('/api/v1/inventory/init', async (req, reply) => {
        const { skuId, totalStock, isHot, segmentCount } = req.body;
        if (!skuId || totalStock === undefined) {
            return reply.status(400).send({ error: 'skuId and totalStock required' });
        }
        await inventoryService_1.inventoryService.initStock(skuId, totalStock, isHot, segmentCount);
        return reply.send({ skuId, totalStock, isHot: !!isHot, segmentCount: segmentCount || 1 });
    });
    app.post('/api/v1/rate-limit', async (req, reply) => {
        const { merchantId, limit, windowMs, burstLimit } = req.body;
        if (!merchantId || !limit) {
            return reply.status(400).send({ error: 'merchantId and limit required' });
        }
        rateLimiter_1.dynamicRateLimiter.setRule(merchantId, limit, windowMs, burstLimit);
        await rateLimiter_1.dynamicRateLimiter.persistRuleToRedis(merchantId);
        return reply.send({ merchantId, limit, windowMs: windowMs || 60000, burstLimit: burstLimit || Math.floor(limit * 0.5) });
    });
    app.get('/api/v1/rate-limit', async (req, reply) => {
        const rules = rateLimiter_1.dynamicRateLimiter.getAllRules();
        return reply.send({ rules });
    });
    app.get('/api/v1/monitoring/metrics', async (req, reply) => {
        const snapshot = metrics_1.metrics.getSnapshot();
        return reply.send(snapshot);
    });
    app.get('/api/v1/monitoring/traces', async (req, reply) => {
        const count = parseInt(req.query.count || '20', 10);
        const traces = tracing_1.tracer.getRecentTraces(count);
        return reply.send({ traces });
    });
    app.get('/api/v1/monitoring/circuit-breaker', async (req, reply) => {
        const stats = degradationService_1.circuitBreaker.getStats();
        return reply.send(stats);
    });
    app.get('/health', async (req, reply) => {
        const redisReady = await (async () => {
            try {
                const redis = require('../dal/redis').redisClient;
                return await redis.isReady();
            }
            catch {
                return false;
            }
        })();
        const status = redisReady ? 'healthy' : 'degraded';
        const statusCode = redisReady ? 200 : 503;
        return reply.status(statusCode).send({
            status,
            timestamp: Date.now(),
            redis: redisReady ? 'connected' : 'disconnected',
            circuitBreaker: degradationService_1.circuitBreaker.getState(),
        });
    });
}
//# sourceMappingURL=routes.js.map