import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config';
import { redisClient } from './dal/redis';
import { transactionManager } from './services/transactionManager';
import { dynamicRateLimiter } from './services/rateLimiter';
import { registerRoutes } from './api/routes';
import { logger } from './utils/logger';
import * as path from 'path';
import * as fs from 'fs';

async function bootstrap() {
  const app = Fastify({
    logger: false,
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'reqId',
    ignoreTrailingSlash: true,
  });

  await app.register(cors, { origin: true });

  const redisReady = await redisClient.isReady();
  if (!redisReady) {
    logger.warn('Redis not ready at startup, service will run in degraded mode');
  }

  transactionManager.startTimeoutScanner(5000);

  try {
    await dynamicRateLimiter.loadRulesFromRedis();
    logger.info('Rate limit rules loaded from Redis');
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Failed to load rate limit rules');
  }

  await registerRoutes(app);

  app.get('/dashboard', async (_req, reply) => {
    const html = fs.readFileSync(path.join(__dirname, '../dashboard/index.html'), 'utf8');
    reply.type('text/html').send(html);
  });

  app.get('/dashboard/style.css', async (_req, reply) => {
    const css = fs.readFileSync(path.join(__dirname, '../dashboard/style.css'), 'utf8');
    reply.type('text/css').send(css);
  });

  app.get('/dashboard/app.js', async (_req, reply) => {
    const js = fs.readFileSync(path.join(__dirname, '../dashboard/app.js'), 'utf8');
    reply.type('application/javascript').send(js);
  });

  app.setNotFoundHandler(async (_req, reply) => {
    reply.status(404).send({ error: 'Not found' });
  });

  app.setErrorHandler(async (err, _req, reply) => {
    logger.error({ err: err.message }, 'Unhandled error');
    reply.status(500).send({ error: 'Internal server error' });
  });

  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down...');
    transactionManager.stopTimeoutScanner();
    await app.close();
    await redisClient.disconnect();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    logger.info('SIGINT received, shutting down...');
    transactionManager.stopTimeoutScanner();
    await app.close();
    await redisClient.disconnect();
    process.exit(0);
  });

  try {
    await app.listen({ port: config.server.port, host: '0.0.0.0' });
    logger.info({ port: config.server.port }, `🚀 Inventory Deduction API running on port ${config.server.port}`);
    logger.info(`📊 Dashboard: http://localhost:${config.server.port}/dashboard`);
  } catch (err: any) {
    logger.error({ err: err.message }, 'Failed to start server');
    process.exit(1);
  }
}

bootstrap();
