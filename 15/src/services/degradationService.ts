import { logger, createChildLogger } from '../utils/logger';
import { metrics } from '../monitoring/metrics';
import { redisClient } from '../dal/redis';

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

interface CircuitConfig {
  failureThreshold: number;
  recoveryTimeout: number;
  halfOpenMaxAttempts: number;
  monitoringWindow: number;
}

interface LocalCacheEntry {
  value: number;
  expireAt: number;
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures: number = 0;
  private successes: number = 0;
  private lastFailureTime: number = 0;
  private halfOpenAttempts: number = 0;
  private config: CircuitConfig;
  private localCache: Map<string, LocalCacheEntry> = new Map();
  private readonly CACHE_TTL = 30000;

  constructor(config?: Partial<CircuitConfig>) {
    this.config = {
      failureThreshold: config?.failureThreshold ?? 5,
      recoveryTimeout: config?.recoveryTimeout ?? 30000,
      halfOpenMaxAttempts: config?.halfOpenMaxAttempts ?? 3,
      monitoringWindow: config?.monitoringWindow ?? 60000,
    };
  }

  async execute<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastFailureTime > this.config.recoveryTimeout) {
        this.state = CircuitState.HALF_OPEN;
        this.halfOpenAttempts = 0;
        logger.info({ operation }, 'Circuit transitioning to HALF_OPEN');
      } else {
        metrics.increment('circuit_breaker.rejected', { operation });
        throw new Error(`Circuit breaker OPEN for ${operation}`);
      }
    }

    if (this.state === CircuitState.HALF_OPEN) {
      if (this.halfOpenAttempts >= this.config.halfOpenMaxAttempts) {
        this.state = CircuitState.OPEN;
        this.lastFailureTime = Date.now();
        metrics.increment('circuit_breaker.open', { operation });
        throw new Error(`Circuit breaker re-OPENED for ${operation} (half-open max attempts exceeded)`);
      }
      this.halfOpenAttempts++;
    }

    try {
      const result = await fn();
      this.onSuccess(operation);
      return result;
    } catch (err: any) {
      this.onFailure(operation);
      throw err;
    }
  }

  private onSuccess(operation: string): void {
    this.successes++;

    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.CLOSED;
      this.failures = 0;
      this.halfOpenAttempts = 0;
      logger.info({ operation }, 'Circuit CLOSED after successful half-open');
      metrics.increment('circuit_breaker.closed', { operation });
    }
  }

  private onFailure(operation: string): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.OPEN;
      this.halfOpenAttempts = 0;
      logger.warn({ operation }, 'Circuit re-OPENED after half-open failure');
      metrics.increment('circuit_breaker.open', { operation });
      return;
    }

    if (this.failures >= this.config.failureThreshold) {
      this.state = CircuitState.OPEN;
      logger.warn({ operation, failures: this.failures }, 'Circuit OPENED due to failure threshold');
      metrics.increment('circuit_breaker.open', { operation });
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  getStats(): { state: CircuitState; failures: number; successes: number } {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
    };
  }

  async getCachedStock(skuId: string): Promise<number | null> {
    const cached = this.localCache.get(skuId);
    if (cached && cached.expireAt > Date.now()) {
      return cached.value;
    }
    return null;
  }

  setCachedStock(skuId: string, stock: number): void {
    this.localCache.set(skuId, { value: stock, expireAt: Date.now() + this.CACHE_TTL });
  }

  async getStockWithFallback(skuId: string): Promise<number> {
    const log = createChildLogger({ skuId });

    try {
      const stock = await this.execute('getStock', async () => {
        return redisClient.getStock(skuId);
      });

      this.setCachedStock(skuId, stock);
      return stock;
    } catch (err: any) {
      log.warn({ err: err.message }, 'Redis unavailable, using local cache fallback');

      const cached = await this.getCachedStock(skuId);
      if (cached !== null) {
        metrics.increment('degradation.cache_hit', { skuId });
        return cached;
      }

      metrics.increment('degradation.cache_miss', { skuId });
      log.error({ skuId }, 'No cache available, returning -1 to indicate unknown state');
      return -1;
    }
  }

  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successes = 0;
    this.halfOpenAttempts = 0;
  }
}

export const circuitBreaker = new CircuitBreaker();
