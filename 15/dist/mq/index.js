"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mqConsumer = exports.mqProducer = exports.MQJobType = void 0;
const bullmq_1 = require("bullmq");
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
const metrics_1 = require("../monitoring/metrics");
const inventoryService_1 = require("../services/inventoryService");
const transactionManager_1 = require("../services/transactionManager");
var MQJobType;
(function (MQJobType) {
    MQJobType["ASYNC_DB_PERSIST"] = "ASYNC_DB_PERSIST";
    MQJobType["ROLLBACK"] = "ROLLBACK";
    MQJobType["CONFIRM"] = "CONFIRM";
    MQJobType["STOCK_SYNC"] = "STOCK_SYNC";
})(MQJobType || (exports.MQJobType = MQJobType = {}));
const redisConfig = {
    connection: {
        host: config_1.config.redis.host,
        port: config_1.config.redis.port,
        password: config_1.config.redis.password,
        db: config_1.config.redis.db,
    },
};
class MQProducer {
    queue;
    constructor() {
        this.queue = new bullmq_1.Queue('inventory-events', {
            ...redisConfig,
            defaultJobOptions: {
                attempts: config_1.config.mq.attempts,
                backoff: config_1.config.mq.backoff,
                removeOnComplete: { count: 1000 },
                removeOnFail: { count: 5000 },
            },
        });
    }
    async sendAsyncDBPersist(payload) {
        const job = await this.queue.add(MQJobType.ASYNC_DB_PERSIST, payload, {
            jobId: `persist:${payload.txId}`,
            deduplication: {
                id: `persist:${payload.txId}`,
                ttl: 60000,
            },
        });
        logger_1.logger.info({ jobId: job.id, txId: payload.txId }, 'Async DB persist job enqueued');
        metrics_1.metrics.increment('mq.produced', { jobType: MQJobType.ASYNC_DB_PERSIST });
        return String(job.id);
    }
    async sendRollback(payload) {
        const job = await this.queue.add(MQJobType.ROLLBACK, payload, {
            jobId: `rollback:${payload.txId}`,
            priority: 1,
            deduplication: {
                id: `rollback:${payload.txId}`,
                ttl: 60000,
            },
        });
        logger_1.logger.info({ jobId: job.id, txId: payload.txId, reason: payload.reason }, 'Rollback job enqueued');
        metrics_1.metrics.increment('mq.produced', { jobType: MQJobType.ROLLBACK });
        return String(job.id);
    }
    async sendConfirm(payload) {
        const job = await this.queue.add(MQJobType.CONFIRM, payload, {
            jobId: `confirm:${payload.txId}`,
            deduplication: {
                id: `confirm:${payload.txId}`,
                ttl: 60000,
            },
        });
        logger_1.logger.info({ jobId: job.id, txId: payload.txId }, 'Confirm job enqueued');
        metrics_1.metrics.increment('mq.produced', { jobType: MQJobType.CONFIRM });
        return String(job.id);
    }
    async sendStockSync(payload) {
        const job = await this.queue.add(MQJobType.STOCK_SYNC, payload, {
            jobId: `sync:${payload.skuId}:${Date.now()}`,
        });
        logger_1.logger.info({ jobId: job.id, skuId: payload.skuId }, 'Stock sync job enqueued');
        metrics_1.metrics.increment('mq.produced', { jobType: MQJobType.STOCK_SYNC });
        return String(job.id);
    }
    getQueue() {
        return this.queue;
    }
}
class MQConsumer {
    worker;
    constructor() {
        this.worker = new bullmq_1.Worker('inventory-events', async (job) => {
            const log = (0, logger_1.createChildLogger)({ jobId: job.id, jobType: job.name, traceId: job.data.traceId });
            switch (job.name) {
                case MQJobType.ASYNC_DB_PERSIST:
                    await this.handleAsyncDBPersist(job.data, log);
                    break;
                case MQJobType.ROLLBACK:
                    await this.handleRollback(job.data, log);
                    break;
                case MQJobType.CONFIRM:
                    await this.handleConfirm(job.data, log);
                    break;
                case MQJobType.STOCK_SYNC:
                    await this.handleStockSync(job.data, log);
                    break;
                default:
                    log.warn({ jobName: job.name }, 'Unknown job type');
            }
        }, {
            ...redisConfig,
            concurrency: config_1.config.mq.concurrency,
        });
        this.worker.on('completed', (job) => {
            metrics_1.metrics.increment('mq.consumed', { jobType: job.name, status: 'completed' });
        });
        this.worker.on('failed', (job, err) => {
            metrics_1.metrics.increment('mq.consumed', { jobType: job?.name || 'unknown', status: 'failed' });
            logger_1.logger.error({ jobId: job?.id, err: err.message }, 'Job failed');
        });
    }
    async handleAsyncDBPersist(payload, log) {
        log.info({ payload }, 'Persisting deduction to DB');
        try {
            // Simulate DB write - in production this would be a real DB operation
            // await db.query('INSERT INTO inventory_deduction_log (...) VALUES (...)');
            log.info({ txId: payload.txId }, 'DB persist completed');
        }
        catch (err) {
            log.error({ err: err.message }, 'DB persist failed');
            throw err;
        }
    }
    async handleRollback(payload, log) {
        log.info({ payload }, 'Processing rollback');
        const dedTxId = payload.txId;
        const success = await inventoryService_1.inventoryService.rollback(dedTxId, payload.skuId, payload.reason);
        if (!success) {
            log.warn({ txId: payload.txId }, 'Rollback failed in MQ consumer, will retry');
            throw new Error(`Rollback failed for txId=${payload.txId}`);
        }
        const tx = await transactionManager_1.transactionManager.getTransaction(payload.txId);
        if (tx) {
            await transactionManager_1.transactionManager.advanceState(payload.txId, transactionManager_1.TxState.ROLLED_BACK, payload.reason);
        }
    }
    async handleConfirm(payload, log) {
        log.info({ payload }, 'Processing confirm');
        const success = await inventoryService_1.inventoryService.confirm(payload.txId, payload.skuId, payload.quantity);
        if (!success) {
            throw new Error(`Confirm failed for txId=${payload.txId}`);
        }
        await transactionManager_1.transactionManager.advanceState(payload.txId, transactionManager_1.TxState.CONFIRMED);
    }
    async handleStockSync(payload, log) {
        log.info({ payload }, 'Processing stock sync');
        if (payload.dbStock !== payload.redisStock) {
            log.warn({
                skuId: payload.skuId,
                dbStock: payload.dbStock,
                redisStock: payload.redisStock,
            }, 'Stock mismatch detected');
        }
    }
}
exports.mqProducer = new MQProducer();
exports.mqConsumer = new MQConsumer();
//# sourceMappingURL=index.js.map