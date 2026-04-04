import pino, { type Logger, type LoggerOptions } from 'pino';

import type { ServiceConfig } from './config';

export function createLogger(
  config: ServiceConfig,
  bindings: Record<string, string | number | boolean> = {},
  options: LoggerOptions = {}
): Logger {
  return pino({
    level: config.env.LOG_LEVEL,
    base: {
      service: config.serviceName,
      environment: config.env.NODE_ENV,
      ...bindings
    },
    ...options
  });
}
