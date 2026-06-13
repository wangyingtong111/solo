"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inventoryService = exports.InventoryService = exports.DeductResult = void 0;
const uuid_1 = require("uuid");
const redis_1 = require("../dal/redis");
const segmentLock_1 = require("./segmentLock");
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
const metrics_1 = require("../monitoring/metrics");
var DeductResult;
(function (DeductResult) {
    DeductResult["SUCCESS"] = "SUCCESS";
    DeductResult["INSUFFICIENT_STOCK"] = "INSUFFICIENT_STOCK";
    DeductResult["DUPLICATE_REQUEST"] = "DUPLICATE_REQUEST";
    DeductResult["SYSTEM_ERROR"] = "SYSTEM_ERROR";
    DeductResult["CIRCUIT_OPEN"] = "CIRCUIT_OPEN";
})(DeductResult || (exports.DeductResult = DeductResult = {}));
class InventoryService {
    async deduct(req) {
        const traceId = req.traceId || (0, uuid_1.v4)();
        const log = (0, logger_1.createChildLogger)({ traceId, skuId: req.skuId, orderId: req.orderId });
        const startTime = Date.now();
        try {
            const txId = `${req.orderId}:${req.skuId}`;
            const isHot = segmentLock_1.segmentLockService.isHotItem(req.skuId);
            const expireMs = config_1.config.timeout.payment;
            let result;
            if (isHot) {
                const segCount = segmentLock_1.segmentLockService.getSegmentCount(req.skuId);
                result = await redis_1.redisClient.segmentDeduct(req.skuId, txId, req.quantity, segCount, expireMs);
                log.info({ txId, quantity: req.quantity, segments: segCount }, 'Segment deduct executed');
            }
            else {
                result = await redis_1.redisClient.preDeduct(req.skuId, txId, req.quantity, expireMs);
                log.info({ txId, quantity: req.quantity }, 'Pre deduct executed');
            }
            const latencyMs = Date.now() - startTime;
            switch (result) {
                case -1:
                    metrics_1.metrics.increment('deduct.insufficient_stock', { skuId: req.skuId, merchantId: req.merchantId });
                    return {
                        result: DeductResult.INSUFFICIENT_STOCK,
                        txId,
                        remainingStock: 0,
                        traceId,
                        latencyMs,
                    };
                case -2:
                    metrics_1.metrics.increment('deduct.duplicate', { skuId: req.skuId, merchantId: req.merchantId });
                    return {
                        result: DeductResult.DUPLICATE_REQUEST,
                        txId,
                        remainingStock: -1,
                        traceId,
                        latencyMs,
                    };
                default:
                    metrics_1.metrics.increment('deduct.success', { skuId: req.skuId, merchantId: req.merchantId });
                    metrics_1.metrics.timing('deduct.latency', latencyMs, { skuId: req.skuId });
                    return {
                        result: DeductResult.SUCCESS,
                        txId,
                        remainingStock: result,
                        traceId,
                        latencyMs,
                    };
            }
        }
        catch (err) {
            const latencyMs = Date.now() - startTime;
            log.error({ err: err.message, stack: err.stack }, 'Deduct failed');
            metrics_1.metrics.increment('deduct.error', { skuId: req.skuId, merchantId: req.merchantId });
            return {
                result: DeductResult.SYSTEM_ERROR,
                txId: '',
                remainingStock: -1,
                traceId,
                latencyMs,
            };
        }
    }
    async rollback(txId, skuId, reason) {
        const log = (0, logger_1.createChildLogger)({ txId, skuId, reason });
        const startTime = Date.now();
        try {
            const isHot = segmentLock_1.segmentLockService.isHotItem(skuId);
            let result;
            if (isHot) {
                const segCount = segmentLock_1.segmentLockService.getSegmentCount(skuId);
                result = await redis_1.redisClient.segmentRollback(skuId, txId, segCount);
            }
            else {
                result = await redis_1.redisClient.rollback(skuId, txId);
            }
            const latencyMs = Date.now() - startTime;
            log.info({ result, latencyMs, isHot }, 'Rollback executed');
            metrics_1.metrics.increment('rollback.success', { skuId });
            metrics_1.metrics.timing('rollback.latency', latencyMs, { skuId });
            return result > 0;
        }
        catch (err) {
            log.error({ err: err.message }, 'Rollback failed');
            metrics_1.metrics.increment('rollback.error', { skuId });
            return false;
        }
    }
    async confirm(txId, skuId, quantity) {
        const log = (0, logger_1.createChildLogger)({ txId, skuId, quantity });
        const startTime = Date.now();
        try {
            const isHot = segmentLock_1.segmentLockService.isHotItem(skuId);
            let confirmedQty;
            if (isHot) {
                confirmedQty = await redis_1.redisClient.confirmSegmentTx(skuId, txId);
            }
            else {
                confirmedQty = await redis_1.redisClient.confirmDeduct(skuId, txId);
            }
            if (confirmedQty < 0) {
                log.warn({ txId }, 'Confirm failed: TX record not found, may already be confirmed or rolled back');
                metrics_1.metrics.increment('confirm.tx_not_found', { skuId });
                return false;
            }
            const latencyMs = Date.now() - startTime;
            log.info({ txId, confirmedQty, latencyMs, isHot }, 'Transaction confirmed: TX cleaned + sold counter incremented');
            metrics_1.metrics.increment('confirm.success', { skuId });
            metrics_1.metrics.timing('confirm.latency', latencyMs, { skuId });
            return true;
        }
        catch (err) {
            log.error({ err: err.message }, 'Confirm failed');
            metrics_1.metrics.increment('confirm.error', { skuId });
            return false;
        }
    }
    async queryStock(skuId) {
        const isHot = segmentLock_1.segmentLockService.isHotItem(skuId);
        const segCount = isHot ? segmentLock_1.segmentLockService.getSegmentCount(skuId) : 1;
        let available;
        if (isHot) {
            available = await segmentLock_1.segmentLockService.getAggregatedStock(skuId);
        }
        else {
            available = await redis_1.redisClient.getStock(skuId);
        }
        const sold = await redis_1.redisClient.getSoldCount(skuId);
        return {
            skuId,
            available,
            sold,
            segmentCount: segCount,
            isHot,
        };
    }
    async initStock(skuId, totalStock, isHot, segmentCount) {
        if (isHot) {
            segmentLock_1.segmentLockService.registerHotItem(skuId, totalStock, segmentCount);
            await segmentLock_1.segmentLockService.initSegments(skuId, totalStock);
        }
        else {
            await redis_1.redisClient.initStock(skuId, totalStock, 1);
        }
        logger_1.logger.info({ skuId, totalStock, isHot, segmentCount }, 'Stock initialized');
    }
}
exports.InventoryService = InventoryService;
exports.inventoryService = new InventoryService();
//# sourceMappingURL=inventoryService.js.map