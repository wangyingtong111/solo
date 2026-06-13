import dotenv from 'dotenv';
dotenv.config();

export const config = {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0', 10),
    maxRetriesPerRequest: 3,
    retryDelayOnFailover: 200,
    enableReadyCheck: true,
    lazyConnect: false,
  },
  segment: {
    count: parseInt(process.env.SEGMENT_COUNT || '16', 10),
  },
  timeout: {
    deduct: parseInt(process.env.DEDUCT_TIMEOUT_MS || '30000', 10),
    payment: parseInt(process.env.PAYMENT_TIMEOUT_MS || '900000', 10),
  },
  rateLimit: {
    default: parseInt(process.env.RATE_LIMIT_DEFAULT || '1000', 10),
    burst: parseInt(process.env.RATE_LIMIT_BURST || '500', 10),
  },
  server: {
    port: parseInt(process.env.SERVER_PORT || '3000', 10),
  },
  log: {
    level: process.env.LOG_LEVEL || 'info',
  },
  mq: {
    concurrency: parseInt(process.env.MQ_CONCURRENCY || '10', 10),
    attempts: 3,
    backoff: {
      type: 'exponential' as const,
      delay: 1000,
    },
  },
};
