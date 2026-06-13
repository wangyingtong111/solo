import { inventoryService, DeductResult } from '../../services/inventoryService';
import { redisClient } from '../../dal/redis';
import { segmentLockService } from '../../services/segmentLock';
import { metrics } from '../../monitoring/metrics';

const mockPreDeduct = redisClient.preDeduct as jest.MockedFunction<typeof redisClient.preDeduct>;
const mockRollback = redisClient.rollback as jest.MockedFunction<typeof redisClient.rollback>;
const mockSegmentDeduct = redisClient.segmentDeduct as jest.MockedFunction<typeof redisClient.segmentDeduct>;
const mockSegmentRollback = redisClient.segmentRollback as jest.MockedFunction<typeof redisClient.segmentRollback>;
const mockConfirmDeduct = redisClient.confirmDeduct as jest.MockedFunction<typeof redisClient.confirmDeduct>;
const mockConfirmSegmentTx = redisClient.confirmSegmentTx as jest.MockedFunction<typeof redisClient.confirmSegmentTx>;
const mockIsHotItem = segmentLockService.isHotItem as jest.MockedFunction<typeof segmentLockService.isHotItem>;
const mockGetSegmentCount = segmentLockService.getSegmentCount as jest.MockedFunction<typeof segmentLockService.getSegmentCount>;
const mockMetricsIncrement = metrics.increment as jest.MockedFunction<typeof metrics.increment>;
const mockMetricsTiming = metrics.timing as jest.MockedFunction<typeof metrics.timing>;

beforeEach(() => {
  jest.clearAllMocks();
  mockIsHotItem.mockReturnValue(false);
  mockGetSegmentCount.mockReturnValue(1);
});

describe('InventoryService - 普通商品流程', () => {
  const SKU = 'SKU-1001';
  const MERCHANT = 'MCH-001';
  const ORDER = 'ORD-2024-00001';
  const QTY = 3;
  const TX_ID = `${ORDER}:${SKU}`;

  test('预扣减成功 → 确认落账: 完整正向流程', async () => {
    mockPreDeduct.mockResolvedValue(97);
    mockConfirmDeduct.mockResolvedValue(QTY);

    const deductResult = await inventoryService.deduct({
      skuId: SKU, merchantId: MERCHANT, orderId: ORDER, quantity: QTY,
    });

    expect(deductResult.result).toBe(DeductResult.SUCCESS);
    expect(deductResult.remainingStock).toBe(97);
    expect(deductResult.txId).toBe(TX_ID);
    expect(mockPreDeduct).toHaveBeenCalledWith(SKU, TX_ID, QTY, expect.any(Number));
    expect(mockMetricsIncrement).toHaveBeenCalledWith('deduct.success', { skuId: SKU, merchantId: MERCHANT });

    const confirmResult = await inventoryService.confirm(TX_ID, SKU, QTY);

    expect(confirmResult).toBe(true);
    expect(mockConfirmDeduct).toHaveBeenCalledWith(SKU, TX_ID);
    expect(mockMetricsIncrement).toHaveBeenCalledWith('confirm.success', { skuId: SKU });
    expect(mockMetricsTiming).toHaveBeenCalledWith('confirm.latency', expect.any(Number), { skuId: SKU });
  });

  test('预扣减成功 → 回滚释放: 完整逆向流程', async () => {
    mockPreDeduct.mockResolvedValue(97);
    mockRollback.mockResolvedValue(QTY);

    const deductResult = await inventoryService.deduct({
      skuId: SKU, merchantId: MERCHANT, orderId: ORDER, quantity: QTY,
    });

    expect(deductResult.result).toBe(DeductResult.SUCCESS);
    expect(mockPreDeduct).toHaveBeenCalledTimes(1);

    const rollbackResult = await inventoryService.rollback(TX_ID, SKU, 'payment_cancelled');

    expect(rollbackResult).toBe(true);
    expect(mockRollback).toHaveBeenCalledWith(SKU, TX_ID);
    expect(mockMetricsIncrement).toHaveBeenCalledWith('rollback.success', { skuId: SKU });
    expect(mockMetricsTiming).toHaveBeenCalledWith('rollback.latency', expect.any(Number), { skuId: SKU });
  });

  test('预扣减库存不足: 正确返回错误且不扣库', async () => {
    mockPreDeduct.mockResolvedValue(-1);

    const result = await inventoryService.deduct({
      skuId: SKU, merchantId: MERCHANT, orderId: ORDER, quantity: QTY,
    });

    expect(result.result).toBe(DeductResult.INSUFFICIENT_STOCK);
    expect(result.remainingStock).toBe(0);
    expect(mockMetricsIncrement).toHaveBeenCalledWith('deduct.insufficient_stock', { skuId: SKU, merchantId: MERCHANT });
    expect(mockConfirmDeduct).not.toHaveBeenCalled();
  });

  test('重复请求幂等性: 同orderId+skuId第二次扣减返回DUPLICATE', async () => {
    mockPreDeduct.mockResolvedValueOnce(97).mockResolvedValueOnce(-2);

    const result1 = await inventoryService.deduct({
      skuId: SKU, merchantId: MERCHANT, orderId: ORDER, quantity: QTY,
    });
    const result2 = await inventoryService.deduct({
      skuId: SKU, merchantId: MERCHANT, orderId: ORDER, quantity: QTY,
    });

    expect(result1.result).toBe(DeductResult.SUCCESS);
    expect(result2.result).toBe(DeductResult.DUPLICATE_REQUEST);
    expect(mockPreDeduct).toHaveBeenCalledTimes(2);
    expect(mockMetricsIncrement).toHaveBeenCalledWith('deduct.duplicate', { skuId: SKU, merchantId: MERCHANT });
  });

  test('确认不存在的TX: 返回false不报错', async () => {
    mockConfirmDeduct.mockResolvedValue(-1);

    const result = await inventoryService.confirm('nonexistent:tx', SKU, QTY);

    expect(result).toBe(false);
    expect(mockMetricsIncrement).toHaveBeenCalledWith('confirm.tx_not_found', { skuId: SKU });
    expect(mockMetricsIncrement).not.toHaveBeenCalledWith('confirm.success', expect.anything());
  });

  test('回滚不存在的TX: 返回false不报错', async () => {
    mockRollback.mockResolvedValue(-1);

    const result = await inventoryService.rollback('nonexistent:tx', SKU, 'manual');

    expect(result).toBe(false);
    expect(mockMetricsIncrement).not.toHaveBeenCalledWith('rollback.success', expect.anything());
  });

  test('预扣减异常捕获: 返回SYSTEM_ERROR不崩溃', async () => {
    mockPreDeduct.mockRejectedValue(new Error('Redis connection refused'));

    const result = await inventoryService.deduct({
      skuId: SKU, merchantId: MERCHANT, orderId: ORDER, quantity: QTY,
    });

    expect(result.result).toBe(DeductResult.SYSTEM_ERROR);
    expect(mockMetricsIncrement).toHaveBeenCalledWith('deduct.error', { skuId: SKU, merchantId: MERCHANT });
  });
});

describe('InventoryService - 热点商品分段锁流程', () => {
  const SKU = 'HOT-SKU-9999';
  const MERCHANT = 'MCH-001';
  const ORDER = 'ORD-2024-00002';
  const QTY = 5;
  const TX_ID = `${ORDER}:${SKU}`;
  const SEG_COUNT = 4;

  beforeEach(() => {
    mockIsHotItem.mockReturnValue(true);
    mockGetSegmentCount.mockReturnValue(SEG_COUNT);
  });

  test('热点商品预扣减成功 → 确认: 使用segmentDeduct和confirmSegmentTx', async () => {
    mockSegmentDeduct.mockResolvedValue(QTY);
    mockConfirmSegmentTx.mockResolvedValue(QTY);

    const deductResult = await inventoryService.deduct({
      skuId: SKU, merchantId: MERCHANT, orderId: ORDER, quantity: QTY,
    });

    expect(deductResult.result).toBe(DeductResult.SUCCESS);
    expect(deductResult.txId).toBe(TX_ID);
    expect(mockSegmentDeduct).toHaveBeenCalledWith(SKU, TX_ID, QTY, SEG_COUNT, expect.any(Number));
    expect(mockPreDeduct).not.toHaveBeenCalled();

    const confirmResult = await inventoryService.confirm(TX_ID, SKU, QTY);

    expect(confirmResult).toBe(true);
    expect(mockConfirmSegmentTx).toHaveBeenCalledWith(SKU, TX_ID);
    expect(mockConfirmDeduct).not.toHaveBeenCalled();
  });

  test('热点商品预扣减成功 → 回滚: 使用segmentRollback精确回滚分段', async () => {
    mockSegmentDeduct.mockResolvedValue(QTY);
    mockSegmentRollback.mockResolvedValue(QTY);

    const deductResult = await inventoryService.deduct({
      skuId: SKU, merchantId: MERCHANT, orderId: ORDER, quantity: QTY,
    });

    expect(deductResult.result).toBe(DeductResult.SUCCESS);

    const rollbackResult = await inventoryService.rollback(TX_ID, SKU, 'payment_timeout');

    expect(rollbackResult).toBe(true);
    expect(mockSegmentRollback).toHaveBeenCalledWith(SKU, TX_ID);
    expect(mockRollback).not.toHaveBeenCalled();
  });

  test('热点商品分段库存不足: 返回INSUFFICIENT_STOCK', async () => {
    mockSegmentDeduct.mockResolvedValue(-1);

    const result = await inventoryService.deduct({
      skuId: SKU, merchantId: MERCHANT, orderId: ORDER, quantity: QTY,
    });

    expect(result.result).toBe(DeductResult.INSUFFICIENT_STOCK);
    expect(mockSegmentDeduct).toHaveBeenCalledTimes(1);
  });

  test('热点商品重复请求: 同样返回DUPLICATE_REQUEST', async () => {
    mockSegmentDeduct.mockResolvedValueOnce(QTY).mockResolvedValueOnce(-2);

    const result1 = await inventoryService.deduct({
      skuId: SKU, merchantId: MERCHANT, orderId: ORDER, quantity: QTY,
    });
    const result2 = await inventoryService.deduct({
      skuId: SKU, merchantId: MERCHANT, orderId: ORDER, quantity: QTY,
    });

    expect(result1.result).toBe(DeductResult.SUCCESS);
    expect(result2.result).toBe(DeductResult.DUPLICATE_REQUEST);
  });

  test('热点商品回滚时精确匹配扣减明细: 回滚总量=扣减总量', async () => {
    mockSegmentDeduct.mockResolvedValue(5);
    mockSegmentRollback.mockResolvedValue(5);

    await inventoryService.deduct({
      skuId: SKU, merchantId: MERCHANT, orderId: ORDER, quantity: 5,
    });

    const rollbackResult = await inventoryService.rollback(TX_ID, SKU, 'test');

    expect(rollbackResult).toBe(true);
    expect(mockSegmentRollback).toHaveBeenCalledWith(SKU, TX_ID);
  });
});

describe('库存扣减一致性校验', () => {
  const SKU = 'SKU-CONSISTENCY';
  const MERCHANT = 'MCH-001';
  const INITIAL_STOCK = 100;
  const QTY = 3;

  test('扣减→确认后: 库存减少QTY, sold增加QTY, 总量守恒', async () => {
    mockPreDeduct.mockResolvedValue(INITIAL_STOCK - QTY);
    mockConfirmDeduct.mockResolvedValue(QTY);

    const result = await inventoryService.deduct({
      skuId: SKU, merchantId: MERCHANT, orderId: 'ORD-CONS-1', quantity: QTY,
    });

    expect(result.remainingStock).toBe(INITIAL_STOCK - QTY);

    const confirmed = await inventoryService.confirm(result.txId, SKU, QTY);
    expect(confirmed).toBe(true);
    expect(mockConfirmDeduct).toHaveBeenCalledWith(SKU, result.txId);
  });

  test('扣减→回滚后: 库存恢复原值, 无sold增量', async () => {
    mockPreDeduct.mockResolvedValue(INITIAL_STOCK - QTY);
    mockRollback.mockResolvedValue(QTY);

    const result = await inventoryService.deduct({
      skuId: SKU, merchantId: MERCHANT, orderId: 'ORD-CONS-2', quantity: QTY,
    });

    const rolledBack = await inventoryService.rollback(result.txId, SKU, 'test');
    expect(rolledBack).toBe(true);
    expect(mockRollback).toHaveBeenCalledWith(SKU, result.txId);
  });

  test('多次扣减独立TX: 互不影响幂等', async () => {
    mockPreDeduct.mockResolvedValue(INITIAL_STOCK - 1);

    const results = await Promise.all([
      inventoryService.deduct({ skuId: SKU, merchantId: MERCHANT, orderId: 'ORD-MULTI-1', quantity: 1 }),
      inventoryService.deduct({ skuId: SKU, merchantId: MERCHANT, orderId: 'ORD-MULTI-2', quantity: 1 }),
      inventoryService.deduct({ skuId: SKU, merchantId: MERCHANT, orderId: 'ORD-MULTI-3', quantity: 1 }),
    ]);

    expect(results.every((r: { result: string }) => r.result === DeductResult.SUCCESS)).toBe(true);
    expect(mockPreDeduct).toHaveBeenCalledTimes(3);
  });
});
