"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamicRateLimiter = exports.DynamicRateLimiter = void 0;
const redis_1 = require("../dal/redis");
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
const metrics_1 = require("../monitoring/metrics");
class DynamicRateLimiter {
    rules = new Map();
    defaultLimit;
    defaultWindowMs;
    defaultBurst;
    constructor() {
        this.defaultLimit = config_1.config.rateLimit.default;
        this.defaultWindowMs = 60000;
        this.defaultBurst = config_1.config.rateLimit.burst;
    }
    setRule(merchantId, limit, windowMs = 60000, burstLimit) {
        const rule = {
            merchantId,
            limit,
            windowMs,
            burstLimit: burstLimit || Math.floor(limit * 0.5),
        };
        this.rules.set(merchantId, rule);
        logger_1.logger.info({ merchantId, limit, windowMs, burstLimit: rule.burstLimit }, 'Rate limit rule set');
    }
    removeRule(merchantId) {
        this.rules.delete(merchantId);
    }
    getRule(merchantId) {
        return this.rules.get(merchantId) || null;
    }
    async check(merchantId) {
        const rule = this.rules.get(merchantId) || {
            merchantId,
            limit: this.defaultLimit,
            windowMs: this.defaultWindowMs,
            burstLimit: this.defaultBurst,
        };
        const allowed = await redis_1.redisClient.checkRateLimit(merchantId, rule.limit, rule.windowMs);
        const result = {
            allowed,
            remaining: rule.limit,
            limit: rule.limit,
            retryAfterMs: allowed ? 0 : rule.windowMs,
        };
        if (!allowed) {
            metrics_1.metrics.increment('rate_limit.rejected', { merchantId });
            const log = (0, logger_1.createChildLogger)({ merchantId, limit: rule.limit });
            log.warn('Rate limit exceeded');
        }
        return result;
    }
    async checkWithBurst(merchantId) {
        const normalResult = await this.check(merchantId);
        if (normalResult.allowed)
            return normalResult;
        const rule = this.rules.get(merchantId);
        if (!rule)
            return normalResult;
        const burstAllowed = await redis_1.redisClient.checkRateLimit(`${merchantId}:burst`, rule.burstLimit, rule.windowMs / 6);
        if (burstAllowed) {
            metrics_1.metrics.increment('rate_limit.burst_allowed', { merchantId });
            return {
                allowed: true,
                remaining: rule.burstLimit,
                limit: rule.burstLimit,
                retryAfterMs: 0,
            };
        }
        return normalResult;
    }
    getAllRules() {
        return Array.from(this.rules.values());
    }
    async loadRulesFromRedis() {
        const redis = redis_1.redisClient.getClient();
        const data = await redis.hgetall('ratelimit:config');
        for (const [merchantId, json] of Object.entries(data)) {
            try {
                const parsed = JSON.parse(json);
                this.setRule(merchantId, parsed.limit, parsed.windowMs);
            }
            catch {
                logger_1.logger.warn({ merchantId }, 'Invalid rate limit config in Redis');
            }
        }
    }
    async persistRuleToRedis(merchantId) {
        const rule = this.rules.get(merchantId);
        if (!rule)
            return;
        await redis_1.redisClient.setMerchantRateLimit(merchantId, rule.limit, rule.windowMs);
    }
}
exports.DynamicRateLimiter = DynamicRateLimiter;
exports.dynamicRateLimiter = new DynamicRateLimiter();
//# sourceMappingURL=rateLimiter.js.map