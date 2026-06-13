import { redisClient } from '../dal/redis';
import { config } from '../config';
import { logger } from '../utils/logger';

interface SegmentAllocation {
  segmentIndex: number;
  quantity: number;
}

interface HotItemConfig {
  skuId: string;
  totalStock: number;
  segmentCount: number;
  threshold: number;
}

export class SegmentLockService {
  private hotItems: Map<string, HotItemConfig> = new Map();
  private segmentCount: number;

  constructor() {
    this.segmentCount = config.segment.count;
  }

  isHotItem(skuId: string): boolean {
    return this.hotItems.has(skuId);
  }

  registerHotItem(skuId: string, totalStock: number, segmentCount?: number, threshold: number = 1000): void {
    const segCount = segmentCount || this.segmentCount;
    const hotConfig: HotItemConfig = {
      skuId,
      totalStock,
      segmentCount: segCount,
      threshold,
    };
    this.hotItems.set(skuId, hotConfig);
    logger.info({ skuId, segmentCount: segCount, totalStock }, 'Hot item registered with segmented lock');
  }

  unregisterHotItem(skuId: string): void {
    this.hotItems.delete(skuId);
  }

  getSegmentCount(skuId: string): number {
    const config = this.hotItems.get(skuId);
    return config ? config.segmentCount : 1;
  }

  async initSegments(skuId: string, totalStock: number): Promise<void> {
    const hotConfig = this.hotItems.get(skuId);
    if (!hotConfig) return;

    await redisClient.initStock(skuId, totalStock, hotConfig.segmentCount);
    logger.info({ skuId, totalStock, segments: hotConfig.segmentCount }, 'Segmented stock initialized');
  }

  selectSegment(skuId: string, quantity: number): SegmentAllocation[] {
    const hotConfig = this.hotItems.get(skuId);
    if (!hotConfig) return [];

    const segCount = hotConfig.segmentCount;
    const hash = this.hashSkuId(skuId);
    const startSeg = hash % segCount;

    const allocations: SegmentAllocation[] = [];
    let remaining = quantity;

    for (let offset = 0; offset < segCount && remaining > 0; offset++) {
      const segIndex = (startSeg + offset) % segCount;
      const segQuantity = Math.min(remaining, Math.ceil(quantity / segCount));
      allocations.push({ segmentIndex: segIndex, quantity: segQuantity });
      remaining -= segQuantity;
    }

    return allocations;
  }

  private hashSkuId(skuId: string): number {
    let hash = 0;
    for (let i = 0; i < skuId.length; i++) {
      const char = skuId.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  async getAggregatedStock(skuId: string): Promise<number> {
    const hotConfig = this.hotItems.get(skuId);
    const segCount = hotConfig ? hotConfig.segmentCount : 1;
    return redisClient.getStock(skuId, segCount > 1 ? segCount : undefined);
  }

  async rebalanceSegments(skuId: string): Promise<void> {
    const hotConfig = this.hotItems.get(skuId);
    if (!hotConfig) return;

    const segCount = hotConfig.segmentCount;
    const currentTotal = await this.getAggregatedStock(skuId);

    if (currentTotal <= 0) return;

    const perSeg = Math.ceil(currentTotal / segCount);
    let remaining = currentTotal;

    const redis = redisClient.getClient();
    const pipeline = redis.pipeline();

    for (let i = 0; i < segCount; i++) {
      const alloc = Math.min(perSeg, remaining);
      pipeline.set(`inventory:stock:${skuId}:seg:${i}`, alloc);
      remaining -= alloc;
    }

    await pipeline.exec();
    logger.info({ skuId, totalStock: currentTotal, segments: segCount }, 'Segments rebalanced');
  }
}

export const segmentLockService = new SegmentLockService();
