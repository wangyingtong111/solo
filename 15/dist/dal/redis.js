"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.redisClient = void 0;
const ioredis_1 = __importDefault(require("ioredis"));
const config_1 = require("../config");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const luaScripts = {
    preDeduct: fs.readFileSync(path.join(__dirname, '../../lua/pre_deduct.lua'), 'utf8'),
    rollback: fs.readFileSync(path.join(__dirname, '../../lua/rollback.lua'), 'utf8'),
    segmentDeduct: fs.readFileSync(path.join(__dirname, '../../lua/segment_deduct.lua'), 'utf8'),
    segmentRollback: fs.readFileSync(path.join(__dirname, '../../lua/segment_rollback.lua'), 'utf8'),
    confirmDeduct: fs.readFileSync(path.join(__dirname, '../../lua/confirm_deduct.lua'), 'utf8'),
    confirmSegment: fs.readFileSync(path.join(__dirname, '../../lua/confirm_segment.lua'), 'utf8'),
    rateLimiter: fs.readFileSync(path.join(__dirname, '../../lua/rate_limiter.lua'), 'utf8'),
};
class RedisClient {
    client;
    subscriber;
    scriptsLoaded = false;
    constructor() {
        this.client = new ioredis_1.default({
            ...config_1.config.redis,
            maxRetriesPerRequest: 3,
            retryStrategy: (times) => Math.min(times * 200, 5000),
            reconnectOnError: (err) => {
                const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT'];
                return targetErrors.some(e => err.message.includes(e));
            },
        });
        this.subscriber = new ioredis_1.default({ ...config_1.config.redis, maxRetriesPerRequest: null });
        this.defineCommands();
        this.client.on('error', (err) => {
            console.error('[Redis] Connection error:', err.message);
        });
        this.client.on('connect', () => {
            console.log('[Redis] Connected');
            this.scriptsLoaded = true;
        });
    }
    defineCommands() {
        this.client.defineCommand('preDeduct', { numberOfKeys: 2, lua: luaScripts.preDeduct });
        this.client.defineCommand('rollback', { numberOfKeys: 2, lua: luaScripts.rollback });
        this.client.defineCommand('segmentDeduct', { numberOfKeys: 2, lua: luaScripts.segmentDeduct });
        this.client.defineCommand('segmentRollback', { numberOfKeys: 2, lua: luaScripts.segmentRollback });
        this.client.defineCommand('confirmDeduct', { numberOfKeys: 3, lua: luaScripts.confirmDeduct });
        this.client.defineCommand('confirmSegment', { numberOfKeys: 2, lua: luaScripts.confirmSegment });
        this.client.defineCommand('rateLimiter', { numberOfKeys: 1, lua: luaScripts.rateLimiter });
    }
    getClient() {
        return this.client;
    }
    getSubscriber() {
        return this.subscriber;
    }
    async isReady() {
        if (this.scriptsLoaded)
            return true;
        return new Promise((resolve) => {
            this.client.once('ready', () => {
                this.scriptsLoaded = true;
                resolve(true);
            });
            setTimeout(() => resolve(false), 5000);
        });
    }
    async preDeduct(skuId, txId, quantity, expireMs) {
        const key = `inventory:stock:${skuId}`;
        const txKey = `inventory:tx:${skuId}`;
        const result = await this.client.preDeduct(key, txKey, quantity, txId, expireMs);
        return result;
    }
    async rollback(skuId, txId) {
        const key = `inventory:stock:${skuId}`;
        const txKey = `inventory:tx:${skuId}`;
        const result = await this.client.rollback(key, txKey, txId);
        return result;
    }
    async segmentDeduct(skuId, txId, quantity, segmentCount, expireMs) {
        const txKey = `inventory:tx:${skuId}`;
        const baseKey = `inventory:stock:${skuId}`;
        const result = await this.client.segmentDeduct(txKey, baseKey, segmentCount, quantity, txId, expireMs);
        return result;
    }
    async segmentRollback(skuId, txId, segmentCount) {
        const txKey = `inventory:tx:${skuId}`;
        const baseKey = `inventory:stock:${skuId}`;
        const result = await this.client.segmentRollback(txKey, baseKey, txId, segmentCount);
        return result;
    }
    async confirmDeduct(skuId, txId) {
        const stockKey = `inventory:stock:${skuId}`;
        const txKey = `inventory:tx:${skuId}`;
        const soldKey = `inventory:sold:${skuId}`;
        const result = await this.client.confirmDeduct(stockKey, txKey, soldKey, txId);
        return result;
    }
    async confirmSegmentTx(skuId, txId) {
        const txKey = `inventory:tx:${skuId}`;
        const soldKey = `inventory:sold:${skuId}`;
        const result = await this.client.confirmSegment(txKey, soldKey, txId);
        return result;
    }
    async checkRateLimit(merchantId, limit, windowMs) {
        const key = `ratelimit:${merchantId}:${Math.floor(Date.now() / windowMs)}`;
        const result = await this.client.rateLimiter(key, limit, windowMs, Date.now());
        return result === 1;
    }
    async getStock(skuId, segmentCount) {
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
    async getSoldCount(skuId) {
        const sold = await this.client.get(`inventory:sold:${skuId}`);
        return parseInt(sold || '0', 10);
    }
    async initStock(skuId, totalStock, segmentCount) {
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
        }
        else {
            await this.client.set(`inventory:stock:${skuId}`, totalStock);
        }
    }
    async setMerchantRateLimit(merchantId, limit, windowMs) {
        await this.client.hset('ratelimit:config', merchantId, JSON.stringify({ limit, windowMs }));
    }
    async getMerchantRateLimit(merchantId) {
        const data = await this.client.hget('ratelimit:config', merchantId);
        if (!data)
            return null;
        return JSON.parse(data);
    }
    async disconnect() {
        await this.client.quit();
        await this.subscriber.quit();
    }
}
exports.redisClient = new RedisClient();
//# sourceMappingURL=redis.js.map