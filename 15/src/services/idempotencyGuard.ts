import { redisClient } from '../dal/redis';
import { logger, createChildLogger } from '../utils/logger';
import { metrics } from '../monitoring/metrics';

export enum ProcessResult {
  FIRST_TIME = 'FIRST_TIME',
  ALREADY_PROCESSED = 'ALREADY_PROCESSED',
  ALREADY_PROCESSING = 'ALREADY_PROCESSING',
}

export interface ProcessedRecord {
  status: 'success' | 'failed' | 'processing';
  workerId?: string;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
}

const WORKER_ID = `${process.env.HOSTNAME || 'localhost'}-${process.pid}`;
const PROCESSING_TTL = 60_000;
const PROCESSED_TTL = 24 * 60 * 60 * 1000;

export class IdempotencyGuard {
  private readonly keyPrefix = 'mq:idempotent:';

  private getKey(idempotencyKey: string): string {
    return `${this.keyPrefix}${idempotencyKey}`;
  }

  async tryAcquire(
    idempotencyKey: string,
    jobType: string
  ): Promise<{ result: ProcessResult; record?: ProcessedRecord }> {
    const log = createChildLogger({ idempotencyKey, jobType, workerId: WORKER_ID });
    const key = this.getKey(idempotencyKey);
    const redis = redisClient.getClient();

    const now = Date.now();
    const record: ProcessedRecord = {
      status: 'processing',
      workerId: WORKER_ID,
      startedAt: now,
    };

    const lockAcquired = await redis.set(
      key,
      JSON.stringify(record),
      'PX',
      PROCESSING_TTL,
      'NX'
    );

    if (lockAcquired === 'OK') {
      metrics.increment('mq.idempotency', { jobType, result: ProcessResult.FIRST_TIME });
      log.debug('Idempotency lock acquired');
      return { result: ProcessResult.FIRST_TIME };
    }

    const existingRaw = await redis.get(key);
    if (!existingRaw) {
      metrics.increment('mq.idempotency', { jobType, result: ProcessResult.FIRST_TIME });
      return { result: ProcessResult.FIRST_TIME };
    }

    try {
      const existing: ProcessedRecord = JSON.parse(existingRaw);

      if (existing.status === 'processing') {
        if (existing.startedAt && now - existing.startedAt > PROCESSING_TTL) {
          log.warn({ existingWorkerId: existing.workerId }, 'Processing lock expired, will force acquire');
          await redis.set(
            key,
            JSON.stringify(record),
            'PX',
            PROCESSING_TTL,
            'XX'
          );
          metrics.increment('mq.idempotency', { jobType, result: ProcessResult.FIRST_TIME });
          return { result: ProcessResult.FIRST_TIME };
        }

        metrics.increment('mq.idempotency', { jobType, result: ProcessResult.ALREADY_PROCESSING });
        log.info({ existingWorkerId: existing.workerId }, 'Job is being processed by another worker, skipping');
        return { result: ProcessResult.ALREADY_PROCESSING, record: existing };
      }

      metrics.increment('mq.idempotency', { jobType, result: ProcessResult.ALREADY_PROCESSED });
      log.info({ status: existing.status }, 'Job already processed, skipping duplicate');
      return { result: ProcessResult.ALREADY_PROCESSED, record: existing };
    } catch {
      metrics.increment('mq.idempotency', { jobType, result: ProcessResult.ALREADY_PROCESSING });
      return { result: ProcessResult.ALREADY_PROCESSING };
    }
  }

  async markSuccess(idempotencyKey: string, jobType: string): Promise<void> {
    const key = this.getKey(idempotencyKey);
    const redis = redisClient.getClient();

    const existingRaw = await redis.get(key);
    let record: ProcessedRecord;

    if (existingRaw) {
      try {
        record = JSON.parse(existingRaw);
      } catch {
        record = { status: 'success' };
      }
    } else {
      record = { status: 'success' };
    }

    record.status = 'success';
    record.finishedAt = Date.now();

    await redis.set(key, JSON.stringify(record), 'PX', PROCESSED_TTL);

    const log = createChildLogger({ idempotencyKey, jobType });
    log.debug('Job marked as processed successfully');
  }

  async markFailed(idempotencyKey: string, jobType: string, error: string, retryable: boolean = true): Promise<void> {
    const key = this.getKey(idempotencyKey);
    const redis = redisClient.getClient();

    if (retryable) {
      await redis.del(key);
      return;
    }

    const record: ProcessedRecord = {
      status: 'failed',
      workerId: WORKER_ID,
      finishedAt: Date.now(),
      error,
    };

    await redis.set(key, JSON.stringify(record), 'PX', PROCESSED_TTL);

    const log = createChildLogger({ idempotencyKey, jobType });
    log.error({ error }, 'Job marked as permanently failed');
  }

  async isProcessed(idempotencyKey: string): Promise<boolean> {
    const key = this.getKey(idempotencyKey);
    const redis = redisClient.getClient();
    const raw = await redis.get(key);
    if (!raw) return false;
    try {
      const parsed = JSON.parse(raw);
      return parsed.status === 'success';
    } catch {
      return false;
    }
  }

  async clear(idempotencyKey: string): Promise<void> {
    const key = this.getKey(idempotencyKey);
    const redis = redisClient.getClient();
    await redis.del(key);
  }
}

export const idempotencyGuard = new IdempotencyGuard();
