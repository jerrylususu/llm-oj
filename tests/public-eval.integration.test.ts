import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApiApp } from '@llm-oj/api';
import { createDatabasePool, defaultMigrationsDir, queryRows, runMigrations } from '@llm-oj/db';
import { createLogger, createServiceConfig } from '@llm-oj/shared';
import { runWorkerCycle } from '@llm-oj/worker';

const execFileAsync = promisify(execFile);
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://llm_oj:llm_oj@127.0.0.1:5432/llm_oj_test';
const problemsRoot = path.resolve(process.cwd(), 'examples/problems');

async function createSubmissionZipBase64(workspaceRoot: string): Promise<string> {
  const sourceDir = path.join(workspaceRoot, 'submission-src');
  const zipPath = path.join(workspaceRoot, 'submission.zip');

  await mkdir(sourceDir, { recursive: true });
  await writeFile(
    path.join(sourceDir, 'main.py'),
    [
      'from __future__ import annotations',
      '',
      'import json',
      'import sys',
      '',
      '',
      'def main() -> None:',
      '    payload = json.loads(sys.argv[1])',
      "    print(payload['a'] + payload['b'])",
      '',
      '',
      "if __name__ == '__main__':",
      '    main()',
      ''
    ].join('\n'),
    'utf8'
  );

  await execFileAsync(
    'uv',
    [
      'run',
      'python',
      '-c',
      [
        'from pathlib import Path',
        'import sys',
        'import zipfile',
        '',
        'zip_path = Path(sys.argv[1])',
        'source_dir = Path(sys.argv[2])',
        "with zipfile.ZipFile(zip_path, 'w', compression=zipfile.ZIP_DEFLATED) as zf:",
        "    for file_path in source_dir.rglob('*'):",
        '        if file_path.is_file():',
        '            zf.write(file_path, file_path.relative_to(source_dir))'
      ].join('\n'),
      zipPath,
      sourceDir
    ],
    { cwd: workspaceRoot }
  );

  const buffer = await readFile(zipPath);
  return buffer.toString('base64');
}

describe('public eval worker cycle', () => {
  let storageRoot = '';
  let workspaceRoot = '';
  const apiConfig = createServiceConfig('api', {
    DATABASE_URL: databaseUrl,
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    PROBLEMS_ROOT: problemsRoot,
    STORAGE_ROOT: 'placeholder',
    RUNNER_MODE: 'local'
  });
  const workerConfig = createServiceConfig('worker', {
    DATABASE_URL: databaseUrl,
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    PROBLEMS_ROOT: problemsRoot,
    STORAGE_ROOT: 'placeholder',
    RUNNER_MODE: 'local'
  });
  const db = createDatabasePool(apiConfig);
  const apiApp = createApiApp({
    config: apiConfig,
    db,
    logger: createLogger(apiConfig, {}, { enabled: false })
  });
  const workerLogger = createLogger(workerConfig, {}, { enabled: false });

  beforeAll(async () => {
    storageRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-oj-worker-storage-'));
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-oj-worker-workspace-'));
    Object.assign(apiConfig.env, { STORAGE_ROOT: storageRoot });
    Object.assign(workerConfig.env, { STORAGE_ROOT: storageRoot });

    await db.query('DROP TABLE IF EXISTS discussion_replies');
    await db.query('DROP TABLE IF EXISTS discussion_threads');
    await db.query('DROP TABLE IF EXISTS leaderboard_entries');
    await db.query('DROP TABLE IF EXISTS evaluations');
    await db.query('DROP TABLE IF EXISTS evaluation_jobs');
    await db.query('DROP TABLE IF EXISTS submissions');
    await db.query('DROP TABLE IF EXISTS agent_tokens');
    await db.query('DROP TABLE IF EXISTS problem_versions');
    await db.query('DROP TABLE IF EXISTS problems');
    await db.query('DROP TABLE IF EXISTS agents');
    await db.query('DROP TABLE IF EXISTS service_heartbeats');
    await db.query('DROP TABLE IF EXISTS schema_migrations');
    await runMigrations(db, defaultMigrationsDir());
    await apiApp.ready();
  });

  afterAll(async () => {
    await apiApp.close();
    await db.end();
    await rm(storageRoot, { force: true, recursive: true });
    await rm(workspaceRoot, { force: true, recursive: true });
  });

  it('claims a queued job and writes public evaluation results back', async () => {
    const registerResponse = await request(apiApp.server).post('/api/agents/register').send({
      name: 'worker-e2e-agent'
    });
    const token = (registerResponse.body as { token: string }).token;
    const artifactBase64 = await createSubmissionZipBase64(workspaceRoot);

    const createResponse = await request(apiApp.server)
      .post('/api/submissions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        problem_id: 'sample-sum',
        artifact_base64: artifactBase64,
        explanation: 'public eval smoke test'
      });
    const submissionId = (createResponse.body as { id: string }).id;

    await runWorkerCycle({ config: workerConfig, db, logger: workerLogger });

    const submissionResponse = await request(apiApp.server)
      .get(`/api/submissions/${submissionId}`)
      .set('Authorization', `Bearer ${token}`);
    const submissionBody = submissionResponse.body as {
      status: string;
      visible_after_eval: boolean;
      evaluation: {
        status: string;
        primary_score: number;
        hidden_summary: {
          score: number;
          passed: number;
          total: number;
        };
        shown_results: Array<{ case_id: string; status: string; score: number }>;
      };
    };

    expect(submissionResponse.status).toBe(200);
    expect(submissionBody.status).toBe('completed');
    expect(submissionBody.visible_after_eval).toBe(true);
    expect(submissionBody.evaluation.status).toBe('completed');
    expect(submissionBody.evaluation.primary_score).toBe(1);
    expect(submissionBody.evaluation.hidden_summary).toEqual({
      score: 1,
      passed: 2,
      total: 2
    });
    expect(submissionBody.evaluation.shown_results).toHaveLength(2);

    const jobRows = await queryRows<{ status: string }>(
      db,
      'SELECT status FROM evaluation_jobs WHERE submission_id = $1',
      [submissionId]
    );
    const evaluationRows = await queryRows<{ status: string; primary_score: number }>(
      db,
      'SELECT status, primary_score FROM evaluations WHERE submission_id = $1',
      [submissionId]
    );

    expect(jobRows).toEqual([{ status: 'completed' }]);
    expect(evaluationRows).toEqual([{ status: 'completed', primary_score: 1 }]);
  });

  it('marks the submission as failed when the artifact cannot be extracted', async () => {
    const registerResponse = await request(apiApp.server).post('/api/agents/register').send({
      name: 'worker-failure-agent'
    });
    const token = (registerResponse.body as { token: string }).token;
    const artifactBase64 = await createSubmissionZipBase64(workspaceRoot);

    const createResponse = await request(apiApp.server)
      .post('/api/submissions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        problem_id: 'sample-sum',
        artifact_base64: artifactBase64,
        explanation: 'public eval failure test'
      });
    const submissionId = (createResponse.body as { id: string }).id;

    await db.query(
      `
        UPDATE evaluation_jobs
        SET payload_json = jsonb_set(payload_json, '{artifact_path}', to_jsonb($2::text))
        WHERE submission_id = $1
      `,
      [submissionId, '/tmp/llm-oj-missing-submission.zip']
    );

    await runWorkerCycle({ config: workerConfig, db, logger: workerLogger });

    const submissionResponse = await request(apiApp.server)
      .get(`/api/submissions/${submissionId}`)
      .set('Authorization', `Bearer ${token}`);
    const submissionBody = submissionResponse.body as {
      status: string;
      visible_after_eval: boolean;
      evaluation: {
        status: string;
        primary_score: number | null;
      } | null;
      evaluation_job: {
        status: string;
      } | null;
    };

    expect(submissionResponse.status).toBe(200);
    expect(submissionBody.status).toBe('failed');
    expect(submissionBody.visible_after_eval).toBe(false);
    expect(submissionBody.evaluation?.status).toBe('failed');
    expect(submissionBody.evaluation?.primary_score).toBeNull();
    expect(submissionBody.evaluation_job?.status).toBe('failed');
  });
});
