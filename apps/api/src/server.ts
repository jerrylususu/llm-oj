import { createDatabasePool } from '@llm-oj/db';
import { createLogger, createServiceConfig } from '@llm-oj/shared';

import { createApiApp } from './app';

async function main(): Promise<void> {
  const config = createServiceConfig('api');
  const logger = createLogger(config);
  const db = createDatabasePool(config);
  const app = createApiApp({ config, db, logger });

  try {
    await app.listen({
      host: config.env.API_HOST,
      port: config.env.API_PORT
    });
  } catch (error) {
    logger.error({ err: error }, 'api startup failed');
    await db.end();
    process.exitCode = 1;
    return;
  }

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down api');
    await app.close();
    await db.end();
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

void main();
