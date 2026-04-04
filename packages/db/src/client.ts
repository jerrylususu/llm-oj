import { Pool, type PoolConfig, type QueryResultRow } from 'pg';

import type { ServiceConfig } from '@llm-oj/shared';

export interface DatabaseHealth {
  readonly connected: boolean;
  readonly currentTime: string;
}

export function createDatabasePool(
  config: ServiceConfig,
  overrides: Partial<PoolConfig> = {}
): Pool {
  return new Pool({
    connectionString: config.env.DATABASE_URL,
    max: 10,
    ...overrides
  });
}

export async function checkDatabase(pool: Pool): Promise<DatabaseHealth> {
  const result = await pool.query<{ current_time: string }>('SELECT NOW()::text AS current_time');
  const firstRow = result.rows[0];

  if (!firstRow) {
    throw new Error('数据库健康检查未返回时间戳');
  }

  return {
    connected: true,
    currentTime: firstRow.current_time
  };
}

export async function queryRows<T extends QueryResultRow>(
  pool: Pool,
  queryText: string,
  values: readonly unknown[] = []
): Promise<T[]> {
  const result = await pool.query<T>(queryText, [...values]);
  return result.rows;
}
