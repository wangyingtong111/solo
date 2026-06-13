export declare enum CircuitState {
    CLOSED = "CLOSED",
    OPEN = "OPEN",
    HALF_OPEN = "HALF_OPEN"
}
interface CircuitConfig {
    failureThreshold: number;
    recoveryTimeout: number;
    halfOpenMaxAttempts: number;
    monitoringWindow: number;
}
export declare class CircuitBreaker {
    private state;
    private failures;
    private successes;
    private lastFailureTime;
    private halfOpenAttempts;
    private config;
    private localCache;
    private readonly CACHE_TTL;
    constructor(config?: Partial<CircuitConfig>);
    execute<T>(operation: string, fn: () => Promise<T>): Promise<T>;
    private onSuccess;
    private onFailure;
    getState(): CircuitState;
    getStats(): {
        state: CircuitState;
        failures: number;
        successes: number;
    };
    getCachedStock(skuId: string): Promise<number | null>;
    setCachedStock(skuId: string, stock: number): void;
    getStockWithFallback(skuId: string): Promise<number>;
    reset(): void;
}
export declare const circuitBreaker: CircuitBreaker;
export {};
//# sourceMappingURL=degradationService.d.ts.map