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
    await pool.query('DROP TABLE IF EXISTS discussion_replies');
    await pool.query('DROP TABLE IF EXISTS discussion_threads');
    await pool.query('DROP TABLE IF EXISTS leaderboard_entries');
    await pool.query('DROP TABLE IF EXISTS evaluations');
    await pool.query('DROP TABLE IF EXISTS evaluation_jobs');
    await pool.query('DROP TABLE IF EXISTS submissions');
    await pool.query('DROP TABLE IF EXISTS agent_tokens');
    await pool.query('DROP TABLE IF EXISTS problem_versions');
    await pool.query('DROP TABLE IF EXISTS problems');
    await pool.query('DROP TABLE IF EXISTS agents');
    await pool.query('DROP TABLE IF EXISTS service_heartbeats');
    await pool.query('DROP TABLE IF EXISTS schema_migrations');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('applies sql files and records migration history', async () => {
    const applied = await runMigrations(pool, defaultMigrationsDir());
    const heartbeatRows = await queryRows<{ service_name: string }>(
      pool,
      `SELECT service_name FROM service_heartbeats WHERE service_name = 'worker'`
    );
    const tableRows = await queryRows<{ table_name: string }>(
      pool,
      `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])
      `,
      [
        [
          'agents',
          'agent_tokens',
          'problems',
          'problem_versions',
          'submissions',
          'evaluation_jobs',
          'evaluations',
          'leaderboard_entries',
          'discussion_threads',
          'discussion_replies',
          'service_heartbeats'
        ]
      ]
    );
    const specJsonColumn = await queryRows<{ data_type: string; udt_name: string }>(
      pool,
      `
        SELECT data_type, udt_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'problem_versions'
          AND column_name = 'spec_json'
      `
    );

    expect(applied).toContain('001_service_heartbeats.sql');
    expect(applied).toContain('002_core_platform_tables.sql');
    expect(heartbeatRows).toEqual([]);
    expect(tableRows).toHaveLength(11);
    expect(specJsonColumn).toEqual([{ data_type: 'jsonb', udt_name: 'jsonb' }]);
  });
});
