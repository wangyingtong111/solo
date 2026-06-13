export declare enum TxState {
    INITIATED = "INITIATED",
    PRE_DEDUCTED = "PRE_DEDUCTED",
    CONFIRMED = "CONFIRMED",
    ROLLED_BACK = "ROLLED_BACK",
    TIMED_OUT = "TIMED_OUT"
}
export interface TransactionRecord {
    txId: string;
    orderId: string;
    skuId: string;
    merchantId: string;
    quantity: number;
    state: TxState;
    createdAt: number;
    updatedAt: number;
    expireAt: number;
    reason?: string;
}
export declare class TransactionManager {
    private scanInterval;
    private readonly TX_KEY_PREFIX;
    begin(orderId: string, skuId: string, merchantId: string, quantity: number): Promise<TransactionRecord>;
    advanceState(txId: string, newState: TxState, reason?: string): Promise<TransactionRecord | null>;
    getTransaction(txId: string): Promise<TransactionRecord | null>;
    startTimeoutScanner(intervalMs?: number): void;
    stopTimeoutScanner(): void;
    private scanTimeouts;
}
export declare const transactionManager: TransactionManager;
//# sourceMappingURL=transactionManager.d.ts.map