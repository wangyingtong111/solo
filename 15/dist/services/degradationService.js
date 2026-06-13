"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.circuitBreaker = exports.CircuitBreaker = exports.CircuitState = void 0;
const logger_1 = require("../utils/logger");
const metrics_1 = require("../monitoring/metrics");
const redis_1 = require("../dal/redis");
var CircuitState;
(function (CircuitState) {
    CircuitState["CLOSED"] = "CLOSED";
    CircuitState["OPEN"] = "OPEN";
    CircuitState["HALF_OPEN"] = "HALF_OPEN";
})(CircuitState || (exports.CircuitState = CircuitState = {}));
class CircuitBreaker {
    state = CircuitState.CLOSED;
    failures = 0;
    successes = 0;
    lastFailureTime = 0;
    halfOpenAttempts = 0;
    config;
    localCache = new Map();
    CACHE_TTL = 30000;
    constructor(config) {
        this.config = {
            failureThreshold: config?.failureThreshold ?? 5,
            recoveryTimeout: config?.recoveryTimeout ?? 30000,
            halfOpenMaxAttempts: config?.halfOpenMaxAttempts ?? 3,
            monitoringWindow: config?.monitoringWindow ?? 60000,
        };
    }
    async execute(operation, fn) {
        if (this.state === CircuitState.OPEN) {
            if (Date.now() - this.lastFailureTime > this.config.recoveryTimeout) {
                this.state = CircuitState.HALF_OPEN;
                this.halfOpenAttempts = 0;
                logger_1.logger.info({ operation }, 'Circuit transitioning to HALF_OPEN');
            }
            else {
                metrics_1.metrics.increment('circuit_breaker.rejected', { operation });
                throw new Error(`Circuit breaker OPEN for ${operation}`);
            }
        }
        if (this.state === CircuitState.HALF_OPEN) {
            if (this.halfOpenAttempts >= this.config.halfOpenMaxAttempts) {
                this.state = CircuitState.OPEN;
                this.lastFailureTime = Date.now();
                metrics_1.metrics.increment('circuit_breaker.open', { operation });
                throw new Error(`Circuit breaker re-OPENED for ${operation} (half-open max attempts exceeded)`);
            }
            this.halfOpenAttempts++;
        }
        try {
            const result = await fn();
            this.onSuccess(operation);
            return result;
        }
        catch (err) {
            this.onFailure(operation);
            throw err;
        }
    }
    onSuccess(operation) {
        this.successes++;
        if (this.state === CircuitState.HALF_OPEN) {
            this.state = CircuitState.CLOSED;
            this.failures = 0;
            this.halfOpenAttempts = 0;
            logger_1.logger.info({ operation }, 'Circuit CLOSED after successful half-open');
            metrics_1.metrics.increment('circuit_breaker.closed', { operation });
        }
    }
    onFailure(operation) {
        this.failures++;
        this.lastFailureTime = Date.now();
        if (this.state === CircuitState.HALF_OPEN) {
            this.state = CircuitState.OPEN;
            this.halfOpenAttempts = 0;
            logger_1.logger.warn({ operation }, 'Circuit re-OPENED after half-open failure');
            metrics_1.metrics.increment('circuit_breaker.open', { operation });
            return;
        }
        if (this.failures >= this.config.failureThreshold) {
            this.state = CircuitState.OPEN;
            logger_1.logger.warn({ operation, failures: this.failures }, 'Circuit OPENED due to failure threshold');
            metrics_1.metrics.increment('circuit_breaker.open', { operation });
        }
    }
    getState() {
        return this.state;
    }
    getStats() {
        return {
            state: this.state,
            failures: this.failures,
            successes: this.successes,
        };
    }
    async getCachedStock(skuId) {
        const cached = this.localCache.get(skuId);
        if (cached && cached.expireAt > Date.now()) {
            return cached.value;
        }
        return null;
    }
    setCachedStock(skuId, stock) {
        this.localCache.set(skuId, { value: stock, expireAt: Date.now() + this.CACHE_TTL });
    }
    async getStockWithFallback(skuId) {
        const log = (0, logger_1.createChildLogger)({ skuId });
        try {
            const stock = await this.execute('getStock', async () => {
                return redis_1.redisClient.getStock(skuId);
            });
            this.setCachedStock(skuId, stock);
            return stock;
        }
        catch (err) {
            log.warn({ err: err.message }, 'Redis unavailable, using local cache fallback');
            const cached = await this.getCachedStock(skuId);
            if (cached !== null) {
                metrics_1.metrics.increment('degradation.cache_hit', { skuId });
                return cached;
            }
            metrics_1.metrics.increment('degradation.cache_miss', { skuId });
            log.error({ skuId }, 'No cache available, returning -1 to indicate unknown state');
            return -1;
        }
    }
    reset() {
        this.state = CircuitState.CLOSED;
        this.failures = 0;
        this.successes = 0;
        this.halfOpenAttempts = 0;
    }
}
exports.CircuitBreaker = CircuitBreaker;
exports.circuitBreaker = new CircuitBreaker();
//# sourceMappingURL=degradationService.js.map