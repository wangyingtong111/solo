import { IdempotencyGuard, ProcessResult, ProcessedRecord } from '../../services/idempotencyGuard';
import { redisClient } from '../../dal/redis';
import { metrics } from '../../monitoring/metrics';

const mockGetClient = redisClient.getClient as jest.MockedFunction<typeof redisClient.getClient>;
const mockMetricsIncrement = metrics.increment as jest.MockedFunction<typeof metrics.increment>;
const mockIsProcessed = redisClient.isReady as jest.MockedFunction<typeof redisClient.isReady>;

let mockRedis: Record<string, any> = {};

function createMockRedisClient() {
  return {
    set: jest.fn(async (key: string, value: string, ...args: any[]) => {
      const mode = args.find(a => typeof a === 'string' && (a === 'NX' || a === 'XX'));
      const pxIdx = args.indexOf('PX');
      const ttl = pxIdx >= 0 ? args[pxIdx + 1] : 0;

      if (mode === 'NX') {
        if (mockRedis[key]) {
          return null;
        }
        mockRedis[key] = { value, ttl, setAt: Date.now() };
        return 'OK';
      }
      if (mode === 'XX') {
        if (!mockRedis[key]) {
          return null;
        }
        mockRedis[key] = { value, ttl, setAt: Date.now() };
        return 'OK';
      }
      mockRedis[key] = { value, ttl, setAt: Date.now() };
      return 'OK';
    }),
    get: jest.fn(async (key: string) => {
      const entry = mockRedis[key];
      if (!entry) return null;
      if (entry.ttl && Date.now() - entry.setAt > entry.ttl) {
        delete mockRedis[key];
        return null;
      }
      return entry.value;
    }),
    del: jest.fn(async (...keys: string[]) => {
      let count = 0;
      for (const k of keys) {
        if (mockRedis[k]) {
          delete mockRedis[k];
          count++;
        }
      }
      return count;
    }),
  };
}

describe('IdempotencyGuard', () => {
  let guard: IdempotencyGuard;
  let mockClient: ReturnType<typeof createMockRedisClient>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis = {};
    mockClient = createMockRedisClient();
    mockGetClient.mockReturnValue(mockClient as any);
    guard = new IdempotencyGuard();
  });

  test('第一次请求: tryAcquire 返回 FIRST_TIME', async () => {
    const result = await guard.tryAcquire('tx-123', 'CONFIRM');

    expect(result.result).toBe(ProcessResult.FIRST_TIME);
    expect(mockClient.set).toHaveBeenCalledWith(
      expect.stringContaining('tx-123'),
      expect.any(String),
      'PX',
      expect.any(Number),
      'NX'
    );
    expect(mockMetricsIncrement).toHaveBeenCalledWith('mq.idempotency', {
      jobType: 'CONFIRM',
      result: ProcessResult.FIRST_TIME,
    });
  });

  test('同一 key 第二次请求: 返回 ALREADY_PROCESSING', async () => {
    await guard.tryAcquire('tx-123', 'CONFIRM');
    const result = await guard.tryAcquire('tx-123', 'CONFIRM');

    expect(result.result).toBe(ProcessResult.ALREADY_PROCESSING);
    expect(mockMetricsIncrement).toHaveBeenLastCalledWith('mq.idempotency', {
      jobType: 'CONFIRM',
      result: ProcessResult.ALREADY_PROCESSING,
    });
  });

  test('第一次处理成功后 markSuccess: 第二次请求返回 ALREADY_PROCESSED', async () => {
    await guard.tryAcquire('tx-123', 'CONFIRM');
    await guard.markSuccess('tx-123', 'CONFIRM');

    const result = await guard.tryAcquire('tx-123', 'CONFIRM');

    expect(result.result).toBe(ProcessResult.ALREADY_PROCESSED);
    expect(result.record?.status).toBe('success');
    expect(mockMetricsIncrement).toHaveBeenLastCalledWith('mq.idempotency', {
      jobType: 'CONFIRM',
      result: ProcessResult.ALREADY_PROCESSED,
    });
  });

  test('isProcessed: markSuccess 后返回 true', async () => {
    expect(await guard.isProcessed('tx-123')).toBe(false);

    await guard.tryAcquire('tx-123', 'ROLLBACK');
    expect(await guard.isProcessed('tx-123')).toBe(false);

    await guard.markSuccess('tx-123', 'ROLLBACK');
    expect(await guard.isProcessed('tx-123')).toBe(true);
  });

  test('处理失败可重试: markFailed(retryable=true) 会清锁，下一次可以重试', async () => {
    await guard.tryAcquire('tx-123', 'CONFIRM');
    await guard.markFailed('tx-123', 'CONFIRM', 'temp error', true);

    const result = await guard.tryAcquire('tx-123', 'CONFIRM');

    expect(result.result).toBe(ProcessResult.FIRST_TIME);
  });

  test('处理失败不可重试: markFailed(retryable=false) 永久标记，后续跳过', async () => {
    await guard.tryAcquire('tx-123', 'CONFIRM');
    await guard.markFailed('tx-123', 'CONFIRM', 'fatal error', false);

    const result = await guard.tryAcquire('tx-123', 'CONFIRM');

    expect(result.result).toBe(ProcessResult.ALREADY_PROCESSED);
    expect(result.record?.status).toBe('failed');
    expect(result.record?.error).toBe('fatal error');
  });

  test('两个不同的 key 互不影响', async () => {
    const r1 = await guard.tryAcquire('tx-a', 'CONFIRM');
    const r2 = await guard.tryAcquire('tx-b', 'CONFIRM');

    expect(r1.result).toBe(ProcessResult.FIRST_TIME);
    expect(r2.result).toBe(ProcessResult.FIRST_TIME);
    expect(mockClient.set).toHaveBeenCalledTimes(2);
  });

  test('clear: 主动清除幂等锁后可以重新抢锁', async () => {
    await guard.tryAcquire('tx-123', 'CONFIRM');
    expect((await guard.tryAcquire('tx-123', 'CONFIRM')).result).toBe(ProcessResult.ALREADY_PROCESSING);

    await guard.clear('tx-123');

    expect((await guard.tryAcquire('tx-123', 'CONFIRM')).result).toBe(ProcessResult.FIRST_TIME);
  });

  test('模拟两个 worker 并发抢锁: 只有一个抢到', async () => {
    const guard2 = new IdempotencyGuard();

    const result1 = await guard.tryAcquire('tx-dup', 'CONFIRM');
    const result2 = await guard2.tryAcquire('tx-dup', 'CONFIRM');

    expect(result1.result).toBe(ProcessResult.FIRST_TIME);
    expect(result2.result).toBe(ProcessResult.ALREADY_PROCESSING);
  });
});
