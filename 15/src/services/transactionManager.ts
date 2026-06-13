import { v4 as uuidv4 } from 'uuid';
import { redisClient } from '../dal/redis';
import { inventoryService } from './inventoryService';
import { config } from '../config';
import { logger, createChildLogger } from '../utils/logger';
import { metrics } from '../monitoring/metrics';

export enum TxState {
  INITIATED = 'INITIATED',
  PRE_DEDUCTED = 'PRE_DEDUCTED',
  CONFIRMED = 'CONFIRMED',
  ROLLED_BACK = 'ROLLED_BACK',
  TIMED_OUT = 'TIMED_OUT',
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

export class TransactionManager {
  private scanInterval: NodeJS.Timeout | null = null;
  private readonly TX_KEY_PREFIX = 'transaction:';

  async begin(orderId: string, skuId: string, merchantId: string, quantity: number): Promise<TransactionRecord> {
    const txId = uuidv4();
    const now = Date.now();
    const record: TransactionRecord = {
      txId,
      orderId,
      skuId,
      merchantId,
      quantity,
      state: TxState.INITIATED,
      createdAt: now,
      updatedAt: now,
      expireAt: now + config.timeout.payment,
    };

    const redis = redisClient.getClient();
    await redis.hset(
      `${this.TX_KEY_PREFIX}${txId}`,
      {
        txId,
        orderId,
        skuId,
        merchantId,
        quantity,
        state: TxState.INITIATED,
        createdAt: now,
        updatedAt: now,
        expireAt: record.expireAt,
      }
    );
    await redis.zadd('transaction:timeline', record.expireAt, txId);

    metrics.increment('tx.begin', { merchantId });
    logger.info({ txId, orderId, skuId }, 'Transaction initiated');

    return record;
  }

  async advanceState(txId: string, newState: TxState, reason?: string): Promise<TransactionRecord | null> {
    const redis = redisClient.getClient();
    const key = `${this.TX_KEY_PREFIX}${txId}`;
    const data = await redis.hgetall(key);

    if (!data || !data.txId) return null;

    const record: TransactionRecord = {
      txId: data.txId,
      orderId: data.orderId,
      skuId: data.skuId,
      merchantId: data.merchantId,
      quantity: parseInt(data.quantity, 10),
      state: data.state as TxState,
      createdAt: parseInt(data.createdAt, 10),
      updatedAt: parseInt(data.updatedAt, 10),
      expireAt: parseInt(data.expireAt, 10),
      reason,
    };

    record.state = newState;
    record.updatedAt = Date.now();
    if (reason) record.reason = reason;

    await redis.hset(key, {
      state: newState,
      updatedAt: record.updatedAt,
      ...(reason ? { reason } : {}),
    });

    if (newState === TxState.CONFIRMED || newState === TxState.ROLLED_BACK) {
      await redis.zrem('transaction:timeline', txId);
      const ttl = 86400;
      await redis.expire(key, ttl);
    }

    metrics.increment('tx.state_change', { from: data.state, to: newState, merchantId: record.merchantId });
    logger.info({ txId, from: data.state, to: newState }, 'Transaction state changed');

    return record;
  }

  async getTransaction(txId: string): Promise<TransactionRecord | null> {
    const redis = redisClient.getClient();
    const data = await redis.hgetall(`${this.TX_KEY_PREFIX}${txId}`);

    if (!data || !data.txId) return null;

    return {
      txId: data.txId,
      orderId: data.orderId,
      skuId: data.skuId,
      merchantId: data.merchantId,
      quantity: parseInt(data.quantity, 10),
      state: data.state as TxState,
      createdAt: parseInt(data.createdAt, 10),
      updatedAt: parseInt(data.updatedAt, 10),
      expireAt: parseInt(data.expireAt, 10),
      reason: data.reason,
    };
  }

  startTimeoutScanner(intervalMs: number = 5000): void {
    this.scanInterval = setInterval(() => this.scanTimeouts(), intervalMs);
    logger.info({ intervalMs }, 'Transaction timeout scanner started');
  }

  stopTimeoutScanner(): void {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
  }

  private async scanTimeouts(): Promise<void> {
    const now = Date.now();
    const redis = redisClient.getClient();

    const expiredTxIds = await redis.zrangebyscore('transaction:timeline', 0, now, 'LIMIT', 0, 100);

    for (const txId of expiredTxIds) {
      try {
        const record = await this.getTransaction(txId);
        if (!record) {
          await redis.zrem('transaction:timeline', txId);
          continue;
        }

        if (record.state === TxState.PRE_DEDUCTED || record.state === TxState.INITIATED) {
          const log = createChildLogger({ txId, skuId: record.skuId });

          const dedTxId = `${record.orderId}:${record.skuId}`;
          const rolledBack = await inventoryService.rollback(dedTxId, record.skuId, 'payment_timeout');

          if (rolledBack) {
            await this.advanceState(txId, TxState.TIMED_OUT, 'payment_timeout');
            log.info({ orderId: record.orderId }, 'Auto rollback due to payment timeout');
            metrics.increment('tx.auto_rollback', { merchantId: record.merchantId, reason: 'timeout' });
          } else {
            log.warn({ orderId: record.orderId }, 'Auto rollback failed, will retry');
          }
        }
      } catch (err: any) {
        logger.error({ err: err.message, txId }, 'Timeout scan error');
      }
    }
  }
}

export const transactionManager = new TransactionManager();
