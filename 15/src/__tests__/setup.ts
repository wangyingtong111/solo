process.env.LOG_LEVEL = 'error';
process.env.REDIS_DB = '1';

jest.mock('../dal/redis', () => ({
  redisClient: {
    preDeduct: jest.fn(),
    rollback: jest.fn(),
    segmentDeduct: jest.fn(),
    segmentRollback: jest.fn(),
    confirmDeduct: jest.fn(),
    confirmSegmentTx: jest.fn(),
    getStock: jest.fn(),
    getSoldCount: jest.fn(),
    initStock: jest.fn(),
    isReady: jest.fn().mockResolvedValue(true),
    getClient: jest.fn().mockReturnValue({ hdel: jest.fn() }),
  },
}));

jest.mock('../services/segmentLock', () => ({
  segmentLockService: {
    isHotItem: jest.fn(),
    getSegmentCount: jest.fn(),
    getAggregatedStock: jest.fn(),
    registerHotItem: jest.fn(),
    initSegments: jest.fn(),
  },
}));

jest.mock('../monitoring/metrics', () => ({
  metrics: {
    increment: jest.fn(),
    timing: jest.fn(),
    gauge: jest.fn(),
  },
}));
