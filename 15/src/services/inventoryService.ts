import { v4 as uuidv4 } from 'uuid';
import { redisClient } from '../dal/redis';
import { segmentLockService } from './segmentLock';
import { config } from '../config';
import { logger, createChildLogger } from '../utils/logger';
import { metrics } from '../monitoring/metrics';

export enum DeductResult {
  SUCCESS = 'SUCCESS',
  INSUFFICIENT_STOCK = 'INSUFFICIENT_STOCK',
  DUPLICATE_REQUEST = 'DUPLICATE_REQUEST',
  SYSTEM_ERROR = 'SYSTEM_ERROR',
  CIRCUIT_OPEN = 'CIRCUIT_OPEN',
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
  segmentCount: number;
  isHot: boolean;
}

export class InventoryService {
  async deduct(req: DeductRequest): Promise<DeductResponse> {
    const traceId = req.traceId || uuidv4();
    const log = createChildLogger({ traceId, skuId: req.skuId, orderId: req.orderId });
    const startTime = Date.now();

    try {
      const txId = `${req.orderId}:${req.skuId}`;
      const isHot = segmentLockService.isHotItem(req.skuId);
      const expireMs = config.timeout.payment;

      let result: number;

      if (isHot) {
        const segCount = segmentLockService.getSegmentCount(req.skuId);
        result = await redisClient.segmentDeduct(
          req.skuId, txId, req.quantity, segCount, expireMs
        );
        log.info({ txId, quantity: req.quantity, segments: segCount }, 'Segment deduct executed');
      } else {
        result = await redisClient.preDeduct(req.skuId, txId, req.quantity, expireMs);
        log.info({ txId, quantity: req.quantity }, 'Pre deduct executed');
      }

      const latencyMs = Date.now() - startTime;

      switch (result) {
        case -1:
          metrics.increment('deduct.insufficient_stock', { skuId: req.skuId, merchantId: req.merchantId });
          return {
            result: DeductResult.INSUFFICIENT_STOCK,
            txId,
            remainingStock: 0,
            traceId,
            latencyMs,
          };

        case -2:
          metrics.increment('deduct.duplicate', { skuId: req.skuId, merchantId: req.merchantId });
          return {
            result: DeductResult.DUPLICATE_REQUEST,
            txId,
            remainingStock: -1,
            traceId,
            latencyMs,
          };

        default:
          metrics.increment('deduct.success', { skuId: req.skuId, merchantId: req.merchantId });
          metrics.timing('deduct.latency', latencyMs, { skuId: req.skuId });
          return {
            result: DeductResult.SUCCESS,
            txId,
            remainingStock: result,
            traceId,
            latencyMs,
          };
      }
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      log.error({ err: err.message, stack: err.stack }, 'Deduct failed');
      metrics.increment('deduct.error', { skuId: req.skuId, merchantId: req.merchantId });
      return {
        result: DeductResult.SYSTEM_ERROR,
        txId: '',
        remainingStock: -1,
        traceId,
        latencyMs,
      };
    }
  }

  async rollback(txId: string, skuId: string, reason?: string): Promise<boolean> {
    const log = createChildLogger({ txId, skuId, reason });
    const startTime = Date.now();

    try {
      const isHot = segmentLockService.isHotItem(skuId);
      let result: number;

      if (isHot) {
        const segCount = segmentLockService.getSegmentCount(skuId);
        result = await redisClient.segmentRollback(skuId, txId, segCount);
      } else {
        result = await redisClient.rollback(skuId, txId);
      }

      const latencyMs = Date.now() - startTime;
      log.info({ result, latencyMs, isHot }, 'Rollback executed');
      metrics.increment('rollback.success', { skuId });
      metrics.timing('rollback.latency', latencyMs, { skuId });

      return result > 0;
    } catch (err: any) {
      log.error({ err: err.message }, 'Rollback failed');
      metrics.increment('rollback.error', { skuId });
      return false;
    }
  }

  async confirm(txId: string, skuId: string, quantity: number): Promise<boolean> {
    const log = createChildLogger({ txId, skuId, quantity });

    try {
      const redis = redisClient.getClient();
      await redis.hdel(`inventory:tx:${skuId}`, txId);

      log.info({ txId, quantity }, 'Transaction confirmed, TX record cleaned');
      metrics.increment('confirm.success', { skuId });

      return true;
    } catch (err: any) {
      log.error({ err: err.message }, 'Confirm failed');
      metrics.increment('confirm.error', { skuId });
      return false;
    }
  }

  async queryStock(skuId: string): Promise<StockQueryResponse> {
    const isHot = segmentLockService.isHotItem(skuId);
    const segCount = isHot ? segmentLockService.getSegmentCount(skuId) : 1;

    let available: number;
    if (isHot) {
      available = await segmentLockService.getAggregatedStock(skuId);
    } else {
      available = await redisClient.getStock(skuId);
    }

    return {
      skuId,
      available,
      segmentCount: segCount,
      isHot,
    };
  }

  async initStock(skuId: string, totalStock: number, isHot?: boolean, segmentCount?: number): Promise<void> {
    if (isHot) {
      segmentLockService.registerHotItem(skuId, totalStock, segmentCount);
      await segmentLockService.initSegments(skuId, totalStock);
    } else {
      await redisClient.initStock(skuId, totalStock, 1);
    }
    logger.info({ skuId, totalStock, isHot, segmentCount }, 'Stock initialized');
  }
}

export const inventoryService = new InventoryService();
