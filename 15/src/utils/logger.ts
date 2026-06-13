import pino from 'pino';
import { config } from '../config';

export const logger = pino({
  level: config.log.level,
  transport: config.log.level === 'debug'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
  serializers: {
    err: pino.stdSerializers.err,
    req: (req: any) => ({
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
  timestamp: pino.stdTimeFunctions.isoTime,
});

export function createChildLogger(context: Record<string, any>) {
  return logger.child(context);
}
