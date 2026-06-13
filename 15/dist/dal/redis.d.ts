import Redis from 'ioredis';
declare class RedisClient {
    private client;
    private subscriber;
    private scriptsLoaded;
    constructor();
    private defineCommands;
    getClient(): Redis;
    getSubscriber(): Redis;
    isReady(): Promise<boolean>;
    preDeduct(skuId: string, txId: string, quantity: number, expireMs: number): Promise<number>;
    rollback(skuId: string, txId: string): Promise<number>;
    segmentDeduct(skuId: string, txId: string, quantity: number, segmentCount: number, expireMs: number): Promise<number>;
    segmentRollback(skuId: string, txId: string, segmentCount: number): Promise<number>;
    confirmDeduct(skuId: string, txId: string, quantity: number): Promise<number>;
    checkRateLimit(merchantId: string, limit: number, windowMs: number): Promise<boolean>;
    getStock(skuId: string, segmentCount?: number): Promise<number>;
    initStock(skuId: string, totalStock: number, segmentCount: number): Promise<void>;
    setMerchantRateLimit(merchantId: string, limit: number, windowMs: number): Promise<void>;
    getMerchantRateLimit(merchantId: string): Promise<{
        limit: number;
        windowMs: number;
    } | null>;
    disconnect(): Promise<void>;
}
export declare const redisClient: RedisClient;
export {};
//# sourceMappingURL=redis.d.ts.map