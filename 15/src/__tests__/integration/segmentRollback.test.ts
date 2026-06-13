import Redis from 'ioredis';
import * as fs from 'fs';
import * as path from 'path';

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);

const luaScripts = {
  segmentDeduct: fs.readFileSync(path.join(__dirname, '../../../lua/segment_deduct.lua'), 'utf8'),
  segmentRollback: fs.readFileSync(path.join(__dirname, '../../../lua/segment_rollback.lua'), 'utf8'),
  confirmSegment: fs.readFileSync(path.join(__dirname, '../../../lua/confirm_segment.lua'), 'utf8'),
};

async function isRedisAvailable(): Promise<boolean> {
  try {
    const client = new Redis({
      host: REDIS_HOST,
      port: REDIS_PORT,
      connectTimeout: 1000,
      maxRetriesPerRequest: 1,
    });
    await client.ping();
    await client.quit();
    return true;
  } catch {
    return false;
  }
}

describe('Segment Rollback Bug - 集成测试 (需要Redis)', () => {
  let client: Redis;
  let available = false;

  beforeAll(async () => {
    available = await isRedisAvailable();
    if (!available) {
      console.warn('⚠️  Redis unavailable, skipping integration tests');
      return;
    }
    client = new Redis({
      host: REDIS_HOST,
      port: REDIS_PORT,
      db: 10,
    });

    client.defineCommand('segmentDeduct', { numberOfKeys: 2, lua: luaScripts.segmentDeduct });
    client.defineCommand('segmentRollback', { numberOfKeys: 2, lua: luaScripts.segmentRollback });
    client.defineCommand('confirmSegment', { numberOfKeys: 2, lua: luaScripts.confirmSegment });

    await client.flushdb();
  });

  afterAll(async () => {
    if (available) {
      await client.quit();
    }
  });

  beforeEach(async () => {
    if (!available) return;
    await client.flushdb();
  });

  const itIfRedis = available ? it : it.skip;

  itIfRedis('分段扣减5 → 回滚应该精确回滚5，而不是ceil(5/4)*4=8', async () => {
    const SKU = 'TEST-HOT-001';
    const SEG_COUNT = 4;
    const TOTAL_STOCK = 10;
    const DEDUCT_QTY = 5;
    const TX_ID = 'ORD-TEST:TEST-HOT-001';

    const perSeg = Math.ceil(TOTAL_STOCK / SEG_COUNT);
    for (let i = 0; i < SEG_COUNT; i++) {
      const alloc = Math.min(perSeg, TOTAL_STOCK - perSeg * i);
      if (alloc > 0) {
        await client.set(`inventory:stock:${SKU}:seg:${i}`, alloc);
      }
    }

    let stockBefore = 0;
    for (let i = 0; i < SEG_COUNT; i++) {
      stockBefore += parseInt(await client.get(`inventory:stock:${SKU}:seg:${i}`) || '0', 10);
    }
    expect(stockBefore).toBe(TOTAL_STOCK);

    const deductResult = await (client as any).segmentDeduct(
      `inventory:tx:${SKU}`,
      `inventory:stock:${SKU}`,
      SEG_COUNT,
      DEDUCT_QTY,
      TX_ID,
      60000
    );
    expect(deductResult).toBe(DEDUCT_QTY);

    const txValue = await client.hget(`inventory:tx:${SKU}`, TX_ID);
    console.log('TX明细:', txValue);

    let stockAfterDeduct = 0;
    for (let i = 0; i < SEG_COUNT; i++) {
      stockAfterDeduct += parseInt(await client.get(`inventory:stock:${SKU}:seg:${i}`) || '0', 10);
    }
    expect(stockAfterDeduct).toBe(TOTAL_STOCK - DEDUCT_QTY);

    const rollbackResult = await (client as any).segmentRollback(
      `inventory:tx:${SKU}`,
      `inventory:stock:${SKU}`,
      TX_ID
    );
    expect(rollbackResult).toBe(DEDUCT_QTY);

    let stockAfterRollback = 0;
    for (let i = 0; i < SEG_COUNT; i++) {
      stockAfterRollback += parseInt(await client.get(`inventory:stock:${SKU}:seg:${i}`) || '0', 10);
    }

    console.log('库存变化:', {
      before: stockBefore,
      afterDeduct: stockAfterDeduct,
      afterRollback: stockAfterRollback,
    });

    expect(stockAfterRollback).toBe(TOTAL_STOCK);
    expect(stockAfterRollback).not.toBe(TOTAL_STOCK + 3);
  });

  itIfRedis('分段扣减后确认: sold应该累加实际扣减数量', async () => {
    const SKU = 'TEST-HOT-002';
    const SEG_COUNT = 4;
    const TOTAL_STOCK = 10;
    const DEDUCT_QTY = 7;
    const TX_ID = 'ORD-TEST2:TEST-HOT-002';

    const perSeg = Math.ceil(TOTAL_STOCK / SEG_COUNT);
    for (let i = 0; i < SEG_COUNT; i++) {
      const alloc = Math.min(perSeg, TOTAL_STOCK - perSeg * i);
      if (alloc > 0) {
        await client.set(`inventory:stock:${SKU}:seg:${i}`, alloc);
      }
    }

    await (client as any).segmentDeduct(
      `inventory:tx:${SKU}`,
      `inventory:stock:${SKU}`,
      SEG_COUNT,
      DEDUCT_QTY,
      TX_ID,
      60000
    );

    const confirmResult = await (client as any).confirmSegment(
      `inventory:tx:${SKU}`,
      `inventory:sold:${SKU}`,
      TX_ID
    );
    expect(confirmResult).toBe(DEDUCT_QTY);

    const sold = await client.get(`inventory:sold:${SKU}`);
    expect(sold).toBe(String(DEDUCT_QTY));
  });

  itIfRedis('扣减5在seg0扣3, seg1扣2 → 回滚seg0+3 seg1+2 → 总量精确恢复', async () => {
    const SKU = 'TEST-HOT-003';
    const SEG_COUNT = 16;
    const TX_ID = 'ORD-TEST3:TEST-HOT-003';

    await client.set(`inventory:stock:${SKU}:seg:0`, 3);
    await client.set(`inventory:stock:${SKU}:seg:1`, 2);
    for (let i = 2; i < SEG_COUNT; i++) {
      await client.set(`inventory:stock:${SKU}:seg:${i}`, 0);
    }

    const deductResult = await (client as any).segmentDeduct(
      `inventory:tx:${SKU}`,
      `inventory:stock:${SKU}`,
      SEG_COUNT,
      5,
      TX_ID,
      60000
    );
    expect(deductResult).toBe(5);

    const rollbackResult = await (client as any).segmentRollback(
      `inventory:tx:${SKU}`,
      `inventory:stock:${SKU}`,
      TX_ID
    );
    expect(rollbackResult).toBe(5);

    const seg0 = parseInt(await client.get(`inventory:stock:${SKU}:seg:0`) || '0', 10);
    const seg1 = parseInt(await client.get(`inventory:stock:${SKU}:seg:1`) || '0', 10);

    expect(seg0).toBe(3);
    expect(seg1).toBe(2);
  });
});
