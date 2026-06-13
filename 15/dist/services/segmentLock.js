"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.segmentLockService = exports.SegmentLockService = void 0;
const redis_1 = require("../dal/redis");
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
class SegmentLockService {
    hotItems = new Map();
    segmentCount;
    constructor() {
        this.segmentCount = config_1.config.segment.count;
    }
    isHotItem(skuId) {
        return this.hotItems.has(skuId);
    }
    registerHotItem(skuId, totalStock, segmentCount, threshold = 1000) {
        const segCount = segmentCount || this.segmentCount;
        const hotConfig = {
            skuId,
            totalStock,
            segmentCount: segCount,
            threshold,
        };
        this.hotItems.set(skuId, hotConfig);
        logger_1.logger.info({ skuId, segmentCount: segCount, totalStock }, 'Hot item registered with segmented lock');
    }
    unregisterHotItem(skuId) {
        this.hotItems.delete(skuId);
    }
    getSegmentCount(skuId) {
        const config = this.hotItems.get(skuId);
        return config ? config.segmentCount : 1;
    }
    async initSegments(skuId, totalStock) {
        const hotConfig = this.hotItems.get(skuId);
        if (!hotConfig)
            return;
        await redis_1.redisClient.initStock(skuId, totalStock, hotConfig.segmentCount);
        logger_1.logger.info({ skuId, totalStock, segments: hotConfig.segmentCount }, 'Segmented stock initialized');
    }
    selectSegment(skuId, quantity) {
        const hotConfig = this.hotItems.get(skuId);
        if (!hotConfig)
            return [];
        const segCount = hotConfig.segmentCount;
        const hash = this.hashSkuId(skuId);
        const startSeg = hash % segCount;
        const allocations = [];
        let remaining = quantity;
        for (let offset = 0; offset < segCount && remaining > 0; offset++) {
            const segIndex = (startSeg + offset) % segCount;
            const segQuantity = Math.min(remaining, Math.ceil(quantity / segCount));
            allocations.push({ segmentIndex: segIndex, quantity: segQuantity });
            remaining -= segQuantity;
        }
        return allocations;
    }
    hashSkuId(skuId) {
        let hash = 0;
        for (let i = 0; i < skuId.length; i++) {
            const char = skuId.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash);
    }
    async getAggregatedStock(skuId) {
        const hotConfig = this.hotItems.get(skuId);
        const segCount = hotConfig ? hotConfig.segmentCount : 1;
        return redis_1.redisClient.getStock(skuId, segCount > 1 ? segCount : undefined);
    }
    async rebalanceSegments(skuId) {
        const hotConfig = this.hotItems.get(skuId);
        if (!hotConfig)
            return;
        const segCount = hotConfig.segmentCount;
        const currentTotal = await this.getAggregatedStock(skuId);
        if (currentTotal <= 0)
            return;
        const perSeg = Math.ceil(currentTotal / segCount);
        let remaining = currentTotal;
        const redis = redis_1.redisClient.getClient();
        const pipeline = redis.pipeline();
        for (let i = 0; i < segCount; i++) {
            const alloc = Math.min(perSeg, remaining);
            pipeline.set(`inventory:stock:${skuId}:seg:${i}`, alloc);
            remaining -= alloc;
        }
        await pipeline.exec();
        logger_1.logger.info({ skuId, totalStock: currentTotal, segments: segCount }, 'Segments rebalanced');
    }
}
exports.SegmentLockService = SegmentLockService;
exports.segmentLockService = new SegmentLockService();
//# sourceMappingURL=segmentLock.js.map