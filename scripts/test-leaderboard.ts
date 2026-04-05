import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { createApiApp } from '@llm-oj/api';
import { createDatabasePool, defaultMigrationsDir, runMigrations } from '@llm-oj/db';
import { createLogger, createServiceConfig } from '@llm-oj/shared';
import { runWorkerCycle } from '@llm-oj/worker';

const execFileAsync = promisify(execFile);
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://llm_oj:llm_oj@127.0.0.1:5432/llm_oj_test';
const problemsRoot = path.resolve(process.cwd(), 'examples/problems');

async function createSubmissionZipBase64(
  workspaceRoot: string,
  expression: string,
  label: string
): Promise<string> {
  const sourceDir = path.join(workspaceRoot, label);
  const zipPath = path.join(workspaceRoot, `${label}.zip`);

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
      `    print(${expression})`,
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
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-oj-leaderboard-storage-'));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-oj-leaderboard-workspace-'));
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

    const registerA = await apiApp.inject({
      method: 'POST',
      url: '/api/agents/register',
      payload: { name: 'leader-a' }
    });
    const registerB = await apiApp.inject({
      method: 'POST',
      url: '/api/agents/register',
      payload: { name: 'leader-b' }
    });
    const registerABody: { token: string } = registerA.json();
    const registerBBody: { token: string } = registerB.json();
    const tokenA = registerABody.token;
    const tokenB = registerBBody.token;

    const perfectZip = await createSubmissionZipBase64(
      workspaceRoot,
      "payload['a'] + payload['b']",
      'perfect'
    );
    const wrongZip = await createSubmissionZipBase64(
      workspaceRoot,
      "payload['a'] - payload['b']",
      'wrong'
    );

    const createA = await apiApp.inject({
      method: 'POST',
      url: '/api/submissions',
      headers: {
        authorization: `Bearer ${tokenA}`
      },
      payload: {
        problem_id: 'sample-sum',
        artifact_base64: perfectZip,
        explanation: 'perfect score'
      }
    });
    await runWorkerCycle({
      config: workerConfig,
      db,
      logger: createLogger(workerConfig, {}, { enabled: false })
    });

    await apiApp.inject({
      method: 'POST',
      url: '/api/submissions',
      headers: {
        authorization: `Bearer ${tokenB}`
      },
      payload: {
        problem_id: 'sample-sum',
        artifact_base64: wrongZip,
        explanation: 'wrong score'
      }
    });
    await runWorkerCycle({
      config: workerConfig,
      db,
      logger: createLogger(workerConfig, {}, { enabled: false })
    });

    const createABody: { id: string } = createA.json();
    const firstSubmissionId = createABody.id;

    const thread = await apiApp.inject({
      method: 'POST',
      url: '/api/problems/sample-sum/discussions',
      headers: {
        authorization: `Bearer ${tokenA}`
      },
      payload: {
        title: 'Leaderboard strategy',
        body: 'First solve shown and hidden together.'
      }
    });
    const threadBody: { id: string } = thread.json();
    const threadId = threadBody.id;

    await apiApp.inject({
      method: 'POST',
      url: `/api/discussions/${threadId}/replies`,
      headers: {
        authorization: `Bearer ${tokenA}`
      },
      payload: {
        body: 'Then inspect the public scoreboard.'
      }
    });

    const leaderboardResponse = await apiApp.inject({
      method: 'GET',
      url: '/api/public/problems/sample-sum/leaderboard'
    });
    const leaderboardBody: {
      items: Array<{ agent_name: string; best_hidden_score: number }>;
    } = leaderboardResponse.json();
    const discussionResponse = await apiApp.inject({
      method: 'GET',
      url: '/api/public/problems/sample-sum/discussions'
    });
    const discussionBody: {
      items: Array<{ title: string; replies: unknown[] }>;
    } = discussionResponse.json();
    const submissionPage = await apiApp.inject({
      method: 'GET',
      url: `/submissions/${firstSubmissionId}`
    });
    const leaderboardPage = await apiApp.inject({
      method: 'GET',
      url: '/problems/sample-sum/leaderboard'
    });

    console.log(
      JSON.stringify(
        {
          leaderboardOrder: leaderboardBody.items.map((item) => item.agent_name),
          leaderboardScores: leaderboardBody.items.map((item) => item.best_hidden_score),
          discussionTitles: discussionBody.items.map((item) => item.title),
          discussionReplyCount: discussionBody.items[0]?.replies.length ?? 0,
          submissionPageOk: submissionPage.statusCode === 200,
          leaderboardPageOk: leaderboardPage.statusCode === 200
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
