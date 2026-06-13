import { redisClient } from '../dal/redis';
import { config } from '../config';
import { logger, createChildLogger } from '../utils/logger';
import { metrics } from '../monitoring/metrics';

interface RateLimitRule {
  merchantId: string;
  limit: number;
  windowMs: number;
  burstLimit: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  retryAfterMs: number;
}

export class DynamicRateLimiter {
  private rules: Map<string, RateLimitRule> = new Map();
  private defaultLimit: number;
  private defaultWindowMs: number;
  private defaultBurst: number;

  constructor() {
    this.defaultLimit = config.rateLimit.default;
    this.defaultWindowMs = 60000;
    this.defaultBurst = config.rateLimit.burst;
  }

  setRule(merchantId: string, limit: number, windowMs: number = 60000, burstLimit?: number): void {
    const rule: RateLimitRule = {
      merchantId,
      limit,
      windowMs,
      burstLimit: burstLimit || Math.floor(limit * 0.5),
    };
    this.rules.set(merchantId, rule);
    logger.info({ merchantId, limit, windowMs, burstLimit: rule.burstLimit }, 'Rate limit rule set');
  }

  removeRule(merchantId: string): void {
    this.rules.delete(merchantId);
  }

  getRule(merchantId: string): RateLimitRule | null {
    return this.rules.get(merchantId) || null;
  }

  async check(merchantId: string): Promise<RateLimitResult> {
    const rule = this.rules.get(merchantId) || {
      merchantId,
      limit: this.defaultLimit,
      windowMs: this.defaultWindowMs,
      burstLimit: this.defaultBurst,
    };

    const allowed = await redisClient.checkRateLimit(merchantId, rule.limit, rule.windowMs);

    const result: RateLimitResult = {
      allowed,
      remaining: rule.limit,
      limit: rule.limit,
      retryAfterMs: allowed ? 0 : rule.windowMs,
    };

    if (!allowed) {
      metrics.increment('rate_limit.rejected', { merchantId });
      const log = createChildLogger({ merchantId, limit: rule.limit });
      log.warn('Rate limit exceeded');
    }

    return result;
  }

  async checkWithBurst(merchantId: string): Promise<RateLimitResult> {
    const normalResult = await this.check(merchantId);
    if (normalResult.allowed) return normalResult;

    const rule = this.rules.get(merchantId);
    if (!rule) return normalResult;

    const burstAllowed = await redisClient.checkRateLimit(
      `${merchantId}:burst`,
      rule.burstLimit,
      rule.windowMs / 6
    );

    if (burstAllowed) {
      metrics.increment('rate_limit.burst_allowed', { merchantId });
      return {
        allowed: true,
        remaining: rule.burstLimit,
        limit: rule.burstLimit,
        retryAfterMs: 0,
      };
    }

    return normalResult;
  }

  getAllRules(): RateLimitRule[] {
    return Array.from(this.rules.values());
  }

  async loadRulesFromRedis(): Promise<void> {
    const redis = redisClient.getClient();
    const data = await redis.hgetall('ratelimit:config');

    for (const [merchantId, json] of Object.entries(data)) {
      try {
        const parsed = JSON.parse(json);
        this.setRule(merchantId, parsed.limit, parsed.windowMs);
      } catch {
        logger.warn({ merchantId }, 'Invalid rate limit config in Redis');
      }
    }
  }

  async persistRuleToRedis(merchantId: string): Promise<void> {
    const rule = this.rules.get(merchantId);
    if (!rule) return;

    await redisClient.setMerchantRateLimit(merchantId, rule.limit, rule.windowMs);
  }
}

export const dynamicRateLimiter = new DynamicRateLimiter();
