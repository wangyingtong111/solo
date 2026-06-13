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
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const config_1 = require("./config");
const redis_1 = require("./dal/redis");
const transactionManager_1 = require("./services/transactionManager");
const rateLimiter_1 = require("./services/rateLimiter");
const routes_1 = require("./api/routes");
const logger_1 = require("./utils/logger");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
async function bootstrap() {
    const app = (0, fastify_1.default)({
        logger: false,
        requestIdHeader: 'x-request-id',
        requestIdLogLabel: 'reqId',
        ignoreTrailingSlash: true,
    });
    await app.register(cors_1.default, { origin: true });
    const redisReady = await redis_1.redisClient.isReady();
    if (!redisReady) {
        logger_1.logger.warn('Redis not ready at startup, service will run in degraded mode');
    }
    transactionManager_1.transactionManager.startTimeoutScanner(5000);
    try {
        await rateLimiter_1.dynamicRateLimiter.loadRulesFromRedis();
        logger_1.logger.info('Rate limit rules loaded from Redis');
    }
    catch (err) {
        logger_1.logger.warn({ err: err.message }, 'Failed to load rate limit rules');
    }
    await (0, routes_1.registerRoutes)(app);
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
        logger_1.logger.error({ err: err.message }, 'Unhandled error');
        reply.status(500).send({ error: 'Internal server error' });
    });
    process.on('SIGTERM', async () => {
        logger_1.logger.info('SIGTERM received, shutting down...');
        transactionManager_1.transactionManager.stopTimeoutScanner();
        await app.close();
        await redis_1.redisClient.disconnect();
        process.exit(0);
    });
    process.on('SIGINT', async () => {
        logger_1.logger.info('SIGINT received, shutting down...');
        transactionManager_1.transactionManager.stopTimeoutScanner();
        await app.close();
        await redis_1.redisClient.disconnect();
        process.exit(0);
    });
    try {
        await app.listen({ port: config_1.config.server.port, host: '0.0.0.0' });
        logger_1.logger.info({ port: config_1.config.server.port }, `🚀 Inventory Deduction API running on port ${config_1.config.server.port}`);
        logger_1.logger.info(`📊 Dashboard: http://localhost:${config_1.config.server.port}/dashboard`);
    }
    catch (err) {
        logger_1.logger.error({ err: err.message }, 'Failed to start server');
        process.exit(1);
    }
}
bootstrap();
//# sourceMappingURL=app.js.map