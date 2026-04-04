import { createDatabasePool, defaultMigrationsDir, runMigrations } from '@llm-oj/db';
import { createLogger, createServiceConfig } from '@llm-oj/shared';

import { startWorkerRuntime } from './worker';

async function main(): Promise<void> {
  const config = createServiceConfig('worker');
  const logger = createLogger(config);
  const db = createDatabasePool(config);

  try {
    await runMigrations(db, defaultMigrationsDir(), logger);
    const runtime = await startWorkerRuntime({ config, db, logger });

    const shutdown = async (signal: string): Promise<void> => {
      logger.info({ signal }, 'shutting down worker');
      await runtime.stop();
    };

    process.once('SIGINT', () => {
      void shutdown('SIGINT');
    });
    process.once('SIGTERM', () => {
      void shutdown('SIGTERM');
    });
  } catch (error) {
    logger.error({ err: error }, 'worker startup failed');
    await db.end();
    process.exitCode = 1;
  }
}

void main();
