"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
exports.createChildLogger = createChildLogger;
const pino_1 = __importDefault(require("pino"));
const config_1 = require("../config");
exports.logger = (0, pino_1.default)({
    level: config_1.config.log.level,
    transport: config_1.config.log.level === 'debug'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    serializers: {
        err: pino_1.default.stdSerializers.err,
        req: (req) => ({
            method: req.method,
            url: req.url,
            headers: req.headers,
        }),
    },
    formatters: {
        level: (label) => ({ level: label }),
    },
    base: {
        service: 'inventory-deduction-api',
        pid: process.pid,
    },
    timestamp: pino_1.default.stdTimeFunctions.isoTime,
});
function createChildLogger(context) {
    return exports.logger.child(context);
}
//# sourceMappingURL=logger.js.map