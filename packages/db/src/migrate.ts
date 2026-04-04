import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Logger } from 'pino';
import type { Pool, PoolClient } from 'pg';

const MIGRATIONS_TABLE = 'schema_migrations';

async function ensureMigrationsTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrationIds(client: PoolClient): Promise<Set<string>> {
  const result = await client.query<{ id: string }>(`SELECT id FROM ${MIGRATIONS_TABLE}`);
  return new Set(result.rows.map((row) => row.id));
}

export async function runMigrations(
  pool: Pool,
  migrationsDir: string,
  logger?: Pick<Logger, 'info'>
): Promise<string[]> {
  const files = (await readdir(migrationsDir))
    .filter((entry) => entry.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right));

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await ensureMigrationsTable(client);

    const appliedMigrationIds = await getAppliedMigrationIds(client);
    const newlyApplied: string[] = [];

    for (const file of files) {
      if (appliedMigrationIds.has(file)) {
        continue;
      }

      const sql = await readFile(path.join(migrationsDir, file), 'utf8');
      await client.query(sql);
      await client.query(`INSERT INTO ${MIGRATIONS_TABLE} (id) VALUES ($1)`, [file]);
      newlyApplied.push(file);
      logger?.info({ migration: file }, 'applied migration');
    }

    await client.query('COMMIT');
    return newlyApplied;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function defaultMigrationsDir(): string {
  const candidates = [
    path.resolve(__dirname, '..', 'migrations'),
    path.resolve(__dirname, '..', '..', 'migrations')
  ];

  const resolved = candidates.find((candidate) => existsSync(candidate));

  if (!resolved) {
    throw new Error(`未找到 migrations 目录，已检查: ${candidates.join(', ')}`);
  }

  return resolved;
}
