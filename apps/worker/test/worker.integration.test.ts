import { afterAll, describe, expect, it } from 'vitest';

import { createDatabasePool, defaultMigrationsDir, queryRows, runMigrations } from '@llm-oj/db';
import { createLogger, createServiceConfig } from '@llm-oj/shared';

import { runWorkerCycle } from '../src/worker';

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://llm_oj:llm_oj@127.0.0.1:5432/llm_oj_test';

describe('runWorkerCycle', () => {
  const config = createServiceConfig('worker', {
    DATABASE_URL: databaseUrl,
    NODE_ENV: 'test',
    LOG_LEVEL: 'error'
  });
  const db = createDatabasePool(config);
  const logger = createLogger(config, {}, { enabled: false });

  afterAll(async () => {
    await db.end();
  });

  it('writes a worker heartbeat row', async () => {
    await runMigrations(db, defaultMigrationsDir());
    await runWorkerCycle({ config, db, logger });

    const rows = await queryRows<{ service_name: string; payload: { status: string } }>(
      db,
      'SELECT service_name, payload FROM service_heartbeats WHERE service_name = $1',
      ['worker']
    );
    const firstRow = rows[0];

    expect(firstRow).toBeDefined();
    expect(firstRow?.service_name).toBe('worker');
    expect(firstRow?.payload.status).toBe('idle');
  });
});
