import Fastify from 'fastify';
import type { Pool } from 'pg';
import type { Logger } from 'pino';

import { checkDatabase } from '@llm-oj/db';
import type { ServiceConfig } from '@llm-oj/shared';

export interface CreateApiAppOptions {
  readonly config: ServiceConfig;
  readonly db: Pool;
  readonly logger: Logger;
}

export function createApiApp(options: CreateApiAppOptions) {
  const app = Fastify({
    loggerInstance: options.logger
  });

  app.get('/healthz', async () => {
    const database = await checkDatabase(options.db);

    return {
      status: 'ok',
      service: options.config.serviceName,
      environment: options.config.env.NODE_ENV,
      database
    };
  });

  return app;
}
