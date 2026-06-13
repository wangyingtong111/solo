export declare const config: {
    redis: {
        host: string;
        port: number;
        password: string | undefined;
        db: number;
        maxRetriesPerRequest: number;
        retryDelayOnFailover: number;
        enableReadyCheck: boolean;
        lazyConnect: boolean;
    };
    segment: {
        count: number;
    };
    timeout: {
        deduct: number;
        payment: number;
    };
    rateLimit: {
        default: number;
        burst: number;
    };
    server: {
        port: number;
    };
    log: {
        level: string;
    };
    mq: {
        concurrency: number;
        attempts: number;
        backoff: {
            type: "exponential";
            delay: number;
        };
    };
};
//# sourceMappingURL=index.d.ts.map