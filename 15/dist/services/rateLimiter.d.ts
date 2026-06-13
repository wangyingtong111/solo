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
export declare class DynamicRateLimiter {
    private rules;
    private defaultLimit;
    private defaultWindowMs;
    private defaultBurst;
    constructor();
    setRule(merchantId: string, limit: number, windowMs?: number, burstLimit?: number): void;
    removeRule(merchantId: string): void;
    getRule(merchantId: string): RateLimitRule | null;
    check(merchantId: string): Promise<RateLimitResult>;
    checkWithBurst(merchantId: string): Promise<RateLimitResult>;
    getAllRules(): RateLimitRule[];
    loadRulesFromRedis(): Promise<void>;
    persistRuleToRedis(merchantId: string): Promise<void>;
}
export declare const dynamicRateLimiter: DynamicRateLimiter;
export {};
//# sourceMappingURL=rateLimiter.d.ts.map