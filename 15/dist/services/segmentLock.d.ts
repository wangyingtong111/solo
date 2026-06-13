interface SegmentAllocation {
    segmentIndex: number;
    quantity: number;
}
export declare class SegmentLockService {
    private hotItems;
    private segmentCount;
    constructor();
    isHotItem(skuId: string): boolean;
    registerHotItem(skuId: string, totalStock: number, segmentCount?: number, threshold?: number): void;
    unregisterHotItem(skuId: string): void;
    getSegmentCount(skuId: string): number;
    initSegments(skuId: string, totalStock: number): Promise<void>;
    selectSegment(skuId: string, quantity: number): SegmentAllocation[];
    private hashSkuId;
    getAggregatedStock(skuId: string): Promise<number>;
    rebalanceSegments(skuId: string): Promise<void>;
}
export declare const segmentLockService: SegmentLockService;
export {};
//# sourceMappingURL=segmentLock.d.ts.map