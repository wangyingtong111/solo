export declare enum DeductResult {
    SUCCESS = "SUCCESS",
    INSUFFICIENT_STOCK = "INSUFFICIENT_STOCK",
    DUPLICATE_REQUEST = "DUPLICATE_REQUEST",
    SYSTEM_ERROR = "SYSTEM_ERROR",
    CIRCUIT_OPEN = "CIRCUIT_OPEN"
}
export interface DeductRequest {
    skuId: string;
    merchantId: string;
    orderId: string;
    quantity: number;
    traceId?: string;
}
export interface DeductResponse {
    result: DeductResult;
    txId: string;
    remainingStock: number;
    traceId: string;
    latencyMs: number;
}
export interface StockQueryResponse {
    skuId: string;
    available: number;
    sold: number;
    segmentCount: number;
    isHot: boolean;
}
export declare class InventoryService {
    deduct(req: DeductRequest): Promise<DeductResponse>;
    rollback(txId: string, skuId: string, reason?: string): Promise<boolean>;
    confirm(txId: string, skuId: string, quantity: number): Promise<boolean>;
    queryStock(skuId: string): Promise<StockQueryResponse>;
    initStock(skuId: string, totalStock: number, isHot?: boolean, segmentCount?: number): Promise<void>;
}
export declare const inventoryService: InventoryService;
//# sourceMappingURL=inventoryService.d.ts.map