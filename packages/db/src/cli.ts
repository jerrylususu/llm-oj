import { createDatabasePool, defaultMigrationsDir, runMigrations } from './index';
import { createLogger, createServiceConfig } from '@llm-oj/shared';

async function main(): Promise<void> {
  const config = createServiceConfig('worker');
  const logger = createLogger(config, { command: 'migrate' });
  const pool = createDatabasePool(config);

  try {
    const applied = await runMigrations(pool, defaultMigrationsDir(), logger);
    logger.info({ appliedCount: applied.length, applied }, 'database migrations completed');
  } finally {
    await pool.end();
  }
}

void main();
