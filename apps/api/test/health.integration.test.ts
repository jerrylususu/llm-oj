import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';

import { healthResponseSchema } from '@llm-oj/contracts';
import { createDatabasePool, defaultMigrationsDir, runMigrations } from '@llm-oj/db';
import { createLogger, createServiceConfig } from '@llm-oj/shared';

import { createApiApp } from '../src/app';

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://llm_oj:llm_oj@127.0.0.1:5432/llm_oj_test';

describe('GET /healthz', () => {
  const config = createServiceConfig('api', {
    DATABASE_URL: databaseUrl,
    NODE_ENV: 'test',
    LOG_LEVEL: 'error'
  });
  const db = createDatabasePool(config);
  const app = createApiApp({
    config,
    db,
    logger: createLogger(config, {}, { enabled: false })
  });

  afterAll(async () => {
    await app.close();
    await db.end();
  });

  it('returns service and database health', async () => {
    await runMigrations(db, defaultMigrationsDir());
    await app.ready();

    const response = await request(app.server).get('/healthz');
    const body = healthResponseSchema.parse(response.body);

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.service).toBe('api');
    expect(body.database.connected).toBe(true);
  });
});
