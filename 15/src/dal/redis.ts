import Redis from 'ioredis';
import { config } from '../config';
import * as fs from 'fs';
import * as path from 'path';

const luaScripts: Record<string, string> = {
  preDeduct: fs.readFileSync(path.join(__dirname, '../../lua/pre_deduct.lua'), 'utf8'),
  rollback: fs.readFileSync(path.join(__dirname, '../../lua/rollback.lua'), 'utf8'),
  segmentDeduct: fs.readFileSync(path.join(__dirname, '../../lua/segment_deduct.lua'), 'utf8'),
  segmentRollback: fs.readFileSync(path.join(__dirname, '../../lua/segment_rollback.lua'), 'utf8'),
  confirmDeduct: fs.readFileSync(path.join(__dirname, '../../lua/confirm_deduct.lua'), 'utf8'),
  confirmSegment: fs.readFileSync(path.join(__dirname, '../../lua/confirm_segment.lua'), 'utf8'),
  rateLimiter: fs.readFileSync(path.join(__dirname, '../../lua/rate_limiter.lua'), 'utf8'),
};

class RedisClient {
  private client: Redis;
  private subscriber: Redis;
  private scriptsLoaded = false;

  constructor() {
    this.client = new Redis({
      ...config.redis,
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 200, 5000),
      reconnectOnError: (err) => {
        const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT'];
        return targetErrors.some(e => err.message.includes(e));
      },
    });

    this.subscriber = new Redis({ ...config.redis, maxRetriesPerRequest: null });

    this.defineCommands();

    this.client.on('error', (err) => {
      console.error('[Redis] Connection error:', err.message);
    });

    this.client.on('connect', () => {
      console.log('[Redis] Connected');
      this.scriptsLoaded = true;
    });
  }

  private defineCommands() {
    this.client.defineCommand('preDeduct', { numberOfKeys: 2, lua: luaScripts.preDeduct });
    this.client.defineCommand('rollback', { numberOfKeys: 2, lua: luaScripts.rollback });
    this.client.defineCommand('segmentDeduct', { numberOfKeys: 2, lua: luaScripts.segmentDeduct });
    this.client.defineCommand('segmentRollback', { numberOfKeys: 2, lua: luaScripts.segmentRollback });
    this.client.defineCommand('confirmDeduct', { numberOfKeys: 3, lua: luaScripts.confirmDeduct });
    this.client.defineCommand('confirmSegment', { numberOfKeys: 2, lua: luaScripts.confirmSegment });
    this.client.defineCommand('rateLimiter', { numberOfKeys: 1, lua: luaScripts.rateLimiter });
  }

  getClient(): Redis {
    return this.client;
  }

  getSubscriber(): Redis {
    return this.subscriber;
  }

  async isReady(): Promise<boolean> {
    if (this.scriptsLoaded) return true;
    return new Promise((resolve) => {
      this.client.once('ready', () => {
        this.scriptsLoaded = true;
        resolve(true);
      });
      setTimeout(() => resolve(false), 5000);
    });
  }

  async preDeduct(skuId: string, txId: string, quantity: number, expireMs: number): Promise<number> {
    const key = `inventory:stock:${skuId}`;
    const txKey = `inventory:tx:${skuId}`;
    const result = await (this.client as any).preDeduct(key, txKey, quantity, txId, expireMs);
    return result;
  }

  async rollback(skuId: string, txId: string): Promise<number> {
    const key = `inventory:stock:${skuId}`;
    const txKey = `inventory:tx:${skuId}`;
    const result = await (this.client as any).rollback(key, txKey, txId);
    return result;
  }

  async segmentDeduct(skuId: string, txId: string, quantity: number, segmentCount: number, expireMs: number): Promise<number> {
    const txKey = `inventory:tx:${skuId}`;
    const baseKey = `inventory:stock:${skuId}`;
    const result = await (this.client as any).segmentDeduct(txKey, baseKey, segmentCount, quantity, txId, expireMs);
    return result;
  }

  async segmentRollback(skuId: string, txId: string): Promise<number> {
    const txKey = `inventory:tx:${skuId}`;
    const baseKey = `inventory:stock:${skuId}`;
    const result = await (this.client as any).segmentRollback(txKey, baseKey, txId);
    return result;
  }

  async confirmDeduct(skuId: string, txId: string): Promise<number> {
    const stockKey = `inventory:stock:${skuId}`;
    const txKey = `inventory:tx:${skuId}`;
    const soldKey = `inventory:sold:${skuId}`;
    const result = await (this.client as any).confirmDeduct(stockKey, txKey, soldKey, txId);
    return result;
  }

  async confirmSegmentTx(skuId: string, txId: string): Promise<number> {
    const txKey = `inventory:tx:${skuId}`;
    const soldKey = `inventory:sold:${skuId}`;
    const result = await (this.client as any).confirmSegment(txKey, soldKey, txId);
    return result;
  }

  async checkRateLimit(merchantId: string, limit: number, windowMs: number): Promise<boolean> {
    const key = `ratelimit:${merchantId}:${Math.floor(Date.now() / windowMs)}`;
    const result = await (this.client as any).rateLimiter(key, limit, windowMs, Date.now());
    return result === 1;
  }

  async getStock(skuId: string, segmentCount?: number): Promise<number> {
    if (segmentCount && segmentCount > 1) {
      let total = 0;
      for (let i = 0; i < segmentCount; i++) {
        const segStock = await this.client.get(`inventory:stock:${skuId}:seg:${i}`);
        total += parseInt(segStock || '0', 10);
      }
      return total;
    }
    const stock = await this.client.get(`inventory:stock:${skuId}`);
    return parseInt(stock || '0', 10);
  }

  async getSoldCount(skuId: string): Promise<number> {
    const sold = await this.client.get(`inventory:sold:${skuId}`);
    return parseInt(sold || '0', 10);
  }

  async initStock(skuId: string, totalStock: number, segmentCount: number): Promise<void> {
    if (segmentCount > 1) {
      const perSeg = Math.ceil(totalStock / segmentCount);
      let remaining = totalStock;
      const pipeline = this.client.pipeline();
      for (let i = 0; i < segmentCount; i++) {
        const alloc = Math.min(perSeg, remaining);
        pipeline.set(`inventory:stock:${skuId}:seg:${i}`, alloc);
        remaining -= alloc;
      }
      await pipeline.exec();
    } else {
      await this.client.set(`inventory:stock:${skuId}`, totalStock);
    }
  }

  async setMerchantRateLimit(merchantId: string, limit: number, windowMs: number): Promise<void> {
    await this.client.hset('ratelimit:config', merchantId, JSON.stringify({ limit, windowMs }));
  }

  async getMerchantRateLimit(merchantId: string): Promise<{ limit: number; windowMs: number } | null> {
    const data = await this.client.hget('ratelimit:config', merchantId);
    if (!data) return null;
    return JSON.parse(data);
  }

  async disconnect(): Promise<void> {
    await this.client.quit();
    await this.subscriber.quit();
  }
}

export const redisClient = new RedisClient();
