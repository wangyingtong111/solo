import { Queue } from 'bullmq';
export declare enum MQJobType {
    ASYNC_DB_PERSIST = "ASYNC_DB_PERSIST",
    ROLLBACK = "ROLLBACK",
    CONFIRM = "CONFIRM",
    STOCK_SYNC = "STOCK_SYNC"
}
export interface AsyncDBPersistPayload {
    txId: string;
    orderId: string;
    skuId: string;
    merchantId: string;
    quantity: number;
    traceId: string;
}
export interface RollbackPayload {
    txId: string;
    skuId: string;
    reason: string;
    traceId: string;
}
export interface ConfirmPayload {
    txId: string;
    skuId: string;
    quantity: number;
    traceId: string;
}
export interface StockSyncPayload {
    skuId: string;
    dbStock: number;
    redisStock: number;
    traceId: string;
}
declare class MQProducer {
    private queue;
    constructor();
    sendAsyncDBPersist(payload: AsyncDBPersistPayload): Promise<string>;
    sendRollback(payload: RollbackPayload): Promise<string>;
    sendConfirm(payload: ConfirmPayload): Promise<string>;
    sendStockSync(payload: StockSyncPayload): Promise<string>;
    getQueue(): Queue;
}
declare class MQConsumer {
    private worker;
    constructor();
    private handleAsyncDBPersist;
    private handleRollback;
    private handleConfirm;
    private handleStockSync;
}
export declare const mqProducer: MQProducer;
export declare const mqConsumer: MQConsumer;
export {};
//# sourceMappingURL=index.d.ts.map