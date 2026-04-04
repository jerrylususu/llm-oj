import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { createApiApp } from '@llm-oj/api';
import {
  createDatabasePool,
  defaultMigrationsDir,
  queryRows,
  runMigrations
} from '@llm-oj/db';
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

async function main(): Promise<void> {
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-oj-public-eval-storage-'));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-oj-public-eval-workspace-'));
  const apiConfig = createServiceConfig('api', {
    DATABASE_URL: databaseUrl,
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    PROBLEMS_ROOT: problemsRoot,
    STORAGE_ROOT: storageRoot,
    RUNNER_MODE: 'local'
  });
  const workerConfig = createServiceConfig('worker', {
    DATABASE_URL: databaseUrl,
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    PROBLEMS_ROOT: problemsRoot,
    STORAGE_ROOT: storageRoot,
    RUNNER_MODE: 'local'
  });
  const db = createDatabasePool(apiConfig);
  const apiApp = createApiApp({
    config: apiConfig,
    db,
    logger: createLogger(apiConfig, {}, { enabled: false })
  });

  try {
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

    const registerResponse = await apiApp.inject({
      method: 'POST',
      url: '/api/agents/register',
      payload: { name: 'public-eval-e2e-agent' }
    });
    const registerBody: { token: string } = registerResponse.json();
    const artifactBase64 = await createSubmissionZipBase64(workspaceRoot);

    const createSubmissionResponse = await apiApp.inject({
      method: 'POST',
      url: '/api/submissions',
      headers: {
        authorization: `Bearer ${registerBody.token}`
      },
      payload: {
        problem_id: 'sample-sum',
        artifact_base64: artifactBase64,
        explanation: 'public eval e2e'
      }
    });
    const createSubmissionBody: { id: string } = createSubmissionResponse.json();

    await runWorkerCycle({
      config: workerConfig,
      db,
      logger: createLogger(workerConfig, {}, { enabled: false })
    });

    const submissionResponse = await apiApp.inject({
      method: 'GET',
      url: `/api/submissions/${createSubmissionBody.id}`,
      headers: {
        authorization: `Bearer ${registerBody.token}`
      }
    });
    const submissionBody: {
      status: string;
      visible_after_eval: boolean;
      evaluation: {
        status: string;
        primary_score: number;
        shown_results: unknown[];
        hidden_summary: { score: number; passed: number; total: number };
      } | null;
    } = submissionResponse.json();

    const dbRows = await queryRows<{ submission_status: string; job_status: string; evaluation_status: string }>(
      db,
      `
        SELECT
          s.status AS submission_status,
          j.status AS job_status,
          e.status AS evaluation_status
        FROM submissions s
        JOIN evaluation_jobs j ON j.submission_id = s.id
        JOIN evaluations e ON e.submission_id = s.id
        WHERE s.id = $1
      `,
      [createSubmissionBody.id]
    );

    console.log(
      JSON.stringify(
        {
          createSubmissionStatusCode: createSubmissionResponse.statusCode,
          finalSubmissionStatusCode: submissionResponse.statusCode,
          finalSubmissionStatus: submissionBody.status,
          visibleAfterEval: submissionBody.visible_after_eval,
          evaluationStatus: submissionBody.evaluation?.status ?? null,
          primaryScore: submissionBody.evaluation?.primary_score ?? null,
          shownCaseCount: submissionBody.evaluation?.shown_results.length ?? 0,
          hiddenSummary: submissionBody.evaluation?.hidden_summary ?? null,
          databaseRows: dbRows
        },
        null,
        2
      )
    );
  } finally {
    await apiApp.close();
    await db.end();
    await rm(storageRoot, { force: true, recursive: true });
    await rm(workspaceRoot, { force: true, recursive: true });
  }
}

void main();
