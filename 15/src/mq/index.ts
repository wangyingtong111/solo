import { Queue, Worker, Job } from 'bullmq';
import { redisClient } from '../dal/redis';
import { config } from '../config';
import { logger, createChildLogger } from '../utils/logger';
import { metrics } from '../monitoring/metrics';
import { inventoryService } from '../services/inventoryService';
import { transactionManager, TxState } from '../services/transactionManager';

export enum MQJobType {
  ASYNC_DB_PERSIST = 'ASYNC_DB_PERSIST',
  ROLLBACK = 'ROLLBACK',
  CONFIRM = 'CONFIRM',
  STOCK_SYNC = 'STOCK_SYNC',
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

const redisConfig = {
  connection: {
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    db: config.redis.db,
  },
};

class MQProducer {
  private queue: Queue;

  constructor() {
    this.queue = new Queue('inventory-events', {
      ...redisConfig,
      defaultJobOptions: {
        attempts: config.mq.attempts,
        backoff: config.mq.backoff,
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    });
  }

  async sendAsyncDBPersist(payload: AsyncDBPersistPayload): Promise<string> {
    const job = await this.queue.add(MQJobType.ASYNC_DB_PERSIST, payload, {
      jobId: `persist:${payload.txId}`,
      deduplication: {
        id: `persist:${payload.txId}`,
        ttl: 60000,
      },
    });
    logger.info({ jobId: job.id, txId: payload.txId }, 'Async DB persist job enqueued');
    metrics.increment('mq.produced', { jobType: MQJobType.ASYNC_DB_PERSIST });
    return String(job.id);
  }

  async sendRollback(payload: RollbackPayload): Promise<string> {
    const job = await this.queue.add(MQJobType.ROLLBACK, payload, {
      jobId: `rollback:${payload.txId}`,
      priority: 1,
      deduplication: {
        id: `rollback:${payload.txId}`,
        ttl: 60000,
      },
    });
    logger.info({ jobId: job.id, txId: payload.txId, reason: payload.reason }, 'Rollback job enqueued');
    metrics.increment('mq.produced', { jobType: MQJobType.ROLLBACK });
    return String(job.id);
  }

  async sendConfirm(payload: ConfirmPayload): Promise<string> {
    const job = await this.queue.add(MQJobType.CONFIRM, payload, {
      jobId: `confirm:${payload.txId}`,
      deduplication: {
        id: `confirm:${payload.txId}`,
        ttl: 60000,
      },
    });
    logger.info({ jobId: job.id, txId: payload.txId }, 'Confirm job enqueued');
    metrics.increment('mq.produced', { jobType: MQJobType.CONFIRM });
    return String(job.id);
  }

  async sendStockSync(payload: StockSyncPayload): Promise<string> {
    const job = await this.queue.add(MQJobType.STOCK_SYNC, payload, {
      jobId: `sync:${payload.skuId}:${Date.now()}`,
    });
    logger.info({ jobId: job.id, skuId: payload.skuId }, 'Stock sync job enqueued');
    metrics.increment('mq.produced', { jobType: MQJobType.STOCK_SYNC });
    return String(job.id);
  }

  getQueue(): Queue {
    return this.queue;
  }
}

class MQConsumer {
  private worker: Worker;

  constructor() {
    this.worker = new Worker(
      'inventory-events',
      async (job: Job) => {
        const log = createChildLogger({ jobId: job.id, jobType: job.name, traceId: (job.data as any).traceId });

        switch (job.name) {
          case MQJobType.ASYNC_DB_PERSIST:
            await this.handleAsyncDBPersist(job.data as AsyncDBPersistPayload, log);
            break;
          case MQJobType.ROLLBACK:
            await this.handleRollback(job.data as RollbackPayload, log);
            break;
          case MQJobType.CONFIRM:
            await this.handleConfirm(job.data as ConfirmPayload, log);
            break;
          case MQJobType.STOCK_SYNC:
            await this.handleStockSync(job.data as StockSyncPayload, log);
            break;
          default:
            log.warn({ jobName: job.name }, 'Unknown job type');
        }
      },
      {
        ...redisConfig,
        concurrency: config.mq.concurrency,
      }
    );

    this.worker.on('completed', (job) => {
      metrics.increment('mq.consumed', { jobType: job.name, status: 'completed' });
    });

    this.worker.on('failed', (job, err) => {
      metrics.increment('mq.consumed', { jobType: job?.name || 'unknown', status: 'failed' });
      logger.error({ jobId: job?.id, err: err.message }, 'Job failed');
    });
  }

  private async handleAsyncDBPersist(payload: AsyncDBPersistPayload, log: ReturnType<typeof createChildLogger>): Promise<void> {
    log.info({ payload }, 'Persisting deduction to DB');

    try {
      // Simulate DB write - in production this would be a real DB operation
      // await db.query('INSERT INTO inventory_deduction_log (...) VALUES (...)');
      log.info({ txId: payload.txId }, 'DB persist completed');
    } catch (err: any) {
      log.error({ err: err.message }, 'DB persist failed');
      throw err;
    }
  }

  private async handleRollback(payload: RollbackPayload, log: ReturnType<typeof createChildLogger>): Promise<void> {
    log.info({ payload }, 'Processing rollback');

    const dedTxId = payload.txId;
    const success = await inventoryService.rollback(dedTxId, payload.skuId, payload.reason);

    if (!success) {
      log.warn({ txId: payload.txId }, 'Rollback failed in MQ consumer, will retry');
      throw new Error(`Rollback failed for txId=${payload.txId}`);
    }

    const tx = await transactionManager.getTransaction(payload.txId);
    if (tx) {
      await transactionManager.advanceState(payload.txId, TxState.ROLLED_BACK, payload.reason);
    }
  }

  private async handleConfirm(payload: ConfirmPayload, log: ReturnType<typeof createChildLogger>): Promise<void> {
    log.info({ payload }, 'Processing confirm');

    const success = await inventoryService.confirm(payload.txId, payload.skuId, payload.quantity);

    if (!success) {
      throw new Error(`Confirm failed for txId=${payload.txId}`);
    }

    await transactionManager.advanceState(payload.txId, TxState.CONFIRMED);
  }

  private async handleStockSync(payload: StockSyncPayload, log: ReturnType<typeof createChildLogger>): Promise<void> {
    log.info({ payload }, 'Processing stock sync');

    if (payload.dbStock !== payload.redisStock) {
      log.warn({
        skuId: payload.skuId,
        dbStock: payload.dbStock,
        redisStock: payload.redisStock,
      }, 'Stock mismatch detected');
    }
  }
}

export const mqProducer = new MQProducer();
export const mqConsumer = new MQConsumer();
