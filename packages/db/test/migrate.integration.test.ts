import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabasePool, defaultMigrationsDir, queryRows, runMigrations } from '../src';
import { createServiceConfig } from '@llm-oj/shared';

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://llm_oj:llm_oj@127.0.0.1:5432/llm_oj_test';

describe('runMigrations', () => {
  const config = createServiceConfig('worker', {
    DATABASE_URL: databaseUrl,
    NODE_ENV: 'test'
  });
  const pool = createDatabasePool(config);

  beforeAll(async () => {
    await pool.query('DROP TABLE IF EXISTS service_heartbeats');
    await pool.query('DROP TABLE IF EXISTS schema_migrations');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('applies sql files and records migration history', async () => {
    const applied = await runMigrations(pool, defaultMigrationsDir());
    const rows = await queryRows<{ service_name: string }>(
      pool,
      `SELECT service_name FROM service_heartbeats WHERE service_name = 'worker'`
    );

    expect(applied).toContain('001_service_heartbeats.sql');
    expect(rows).toEqual([]);
  });
});
