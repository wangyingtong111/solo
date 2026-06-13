"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.transactionManager = exports.TransactionManager = exports.TxState = void 0;
const uuid_1 = require("uuid");
const redis_1 = require("../dal/redis");
const inventoryService_1 = require("./inventoryService");
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
const metrics_1 = require("../monitoring/metrics");
var TxState;
(function (TxState) {
    TxState["INITIATED"] = "INITIATED";
    TxState["PRE_DEDUCTED"] = "PRE_DEDUCTED";
    TxState["CONFIRMED"] = "CONFIRMED";
    TxState["ROLLED_BACK"] = "ROLLED_BACK";
    TxState["TIMED_OUT"] = "TIMED_OUT";
})(TxState || (exports.TxState = TxState = {}));
class TransactionManager {
    scanInterval = null;
    TX_KEY_PREFIX = 'transaction:';
    async begin(orderId, skuId, merchantId, quantity) {
        const txId = (0, uuid_1.v4)();
        const now = Date.now();
        const record = {
            txId,
            orderId,
            skuId,
            merchantId,
            quantity,
            state: TxState.INITIATED,
            createdAt: now,
            updatedAt: now,
            expireAt: now + config_1.config.timeout.payment,
        };
        const redis = redis_1.redisClient.getClient();
        await redis.hset(`${this.TX_KEY_PREFIX}${txId}`, {
            txId,
            orderId,
            skuId,
            merchantId,
            quantity,
            state: TxState.INITIATED,
            createdAt: now,
            updatedAt: now,
            expireAt: record.expireAt,
        });
        await redis.zadd('transaction:timeline', record.expireAt, txId);
        metrics_1.metrics.increment('tx.begin', { merchantId });
        logger_1.logger.info({ txId, orderId, skuId }, 'Transaction initiated');
        return record;
    }
    async advanceState(txId, newState, reason) {
        const redis = redis_1.redisClient.getClient();
        const key = `${this.TX_KEY_PREFIX}${txId}`;
        const data = await redis.hgetall(key);
        if (!data || !data.txId)
            return null;
        const record = {
            txId: data.txId,
            orderId: data.orderId,
            skuId: data.skuId,
            merchantId: data.merchantId,
            quantity: parseInt(data.quantity, 10),
            state: data.state,
            createdAt: parseInt(data.createdAt, 10),
            updatedAt: parseInt(data.updatedAt, 10),
            expireAt: parseInt(data.expireAt, 10),
            reason,
        };
        record.state = newState;
        record.updatedAt = Date.now();
        if (reason)
            record.reason = reason;
        await redis.hset(key, {
            state: newState,
            updatedAt: record.updatedAt,
            ...(reason ? { reason } : {}),
        });
        if (newState === TxState.CONFIRMED || newState === TxState.ROLLED_BACK) {
            await redis.zrem('transaction:timeline', txId);
            const ttl = 86400;
            await redis.expire(key, ttl);
        }
        metrics_1.metrics.increment('tx.state_change', { from: data.state, to: newState, merchantId: record.merchantId });
        logger_1.logger.info({ txId, from: data.state, to: newState }, 'Transaction state changed');
        return record;
    }
    async getTransaction(txId) {
        const redis = redis_1.redisClient.getClient();
        const data = await redis.hgetall(`${this.TX_KEY_PREFIX}${txId}`);
        if (!data || !data.txId)
            return null;
        return {
            txId: data.txId,
            orderId: data.orderId,
            skuId: data.skuId,
            merchantId: data.merchantId,
            quantity: parseInt(data.quantity, 10),
            state: data.state,
            createdAt: parseInt(data.createdAt, 10),
            updatedAt: parseInt(data.updatedAt, 10),
            expireAt: parseInt(data.expireAt, 10),
            reason: data.reason,
        };
    }
    startTimeoutScanner(intervalMs = 5000) {
        this.scanInterval = setInterval(() => this.scanTimeouts(), intervalMs);
        logger_1.logger.info({ intervalMs }, 'Transaction timeout scanner started');
    }
    stopTimeoutScanner() {
        if (this.scanInterval) {
            clearInterval(this.scanInterval);
            this.scanInterval = null;
        }
    }
    async scanTimeouts() {
        const now = Date.now();
        const redis = redis_1.redisClient.getClient();
        const expiredTxIds = await redis.zrangebyscore('transaction:timeline', 0, now, 'LIMIT', 0, 100);
        for (const txId of expiredTxIds) {
            try {
                const record = await this.getTransaction(txId);
                if (!record) {
                    await redis.zrem('transaction:timeline', txId);
                    continue;
                }
                if (record.state === TxState.PRE_DEDUCTED || record.state === TxState.INITIATED) {
                    const log = (0, logger_1.createChildLogger)({ txId, skuId: record.skuId });
                    const dedTxId = `${record.orderId}:${record.skuId}`;
                    const rolledBack = await inventoryService_1.inventoryService.rollback(dedTxId, record.skuId, 'payment_timeout');
                    if (rolledBack) {
                        await this.advanceState(txId, TxState.TIMED_OUT, 'payment_timeout');
                        log.info({ orderId: record.orderId }, 'Auto rollback due to payment timeout');
                        metrics_1.metrics.increment('tx.auto_rollback', { merchantId: record.merchantId, reason: 'timeout' });
                    }
                    else {
                        log.warn({ orderId: record.orderId }, 'Auto rollback failed, will retry');
                    }
                }
            }
            catch (err) {
                logger_1.logger.error({ err: err.message, txId }, 'Timeout scan error');
            }
        }
    }
}
exports.TransactionManager = TransactionManager;
exports.transactionManager = new TransactionManager();
//# sourceMappingURL=transactionManager.js.map