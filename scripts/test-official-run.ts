import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
const sampleBundleRoot = path.resolve(process.cwd(), 'examples/problems/sample-sum/v1');
const adminUser = 'admin';
const adminPassword = 'secret';

function basicAuthHeader(): string {
  return `Basic ${Buffer.from(`${adminUser}:${adminPassword}`, 'utf8').toString('base64')}`;
}

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

async function createAdminBundle(rootDir: string): Promise<string> {
  const bundleDir = path.join(rootDir, 'admin-sum', 'v1');
  await cp(sampleBundleRoot, bundleDir, { recursive: true });

  const specPath = path.join(bundleDir, 'spec.json');
  const spec = JSON.parse(await readFile(specPath, 'utf8')) as {
    problem_id: string;
    problem_title: string;
  };
  spec.problem_id = 'admin-sum';
  spec.problem_title = 'Admin Sum';
  await writeFile(specPath, JSON.stringify(spec, null, 2), 'utf8');

  await writeFile(
    path.join(bundleDir, 'statement.md'),
    '# Admin Sum\n\n给定两个整数 `a` 和 `b`，输出它们的和。\n',
    'utf8'
  );

  return bundleDir;
}

async function main(): Promise<void> {
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-oj-official-storage-'));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-oj-official-workspace-'));
  const problemsRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-oj-official-problems-'));
  const bundleRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-oj-official-bundle-'));
  const bundleDir = await createAdminBundle(bundleRoot);
  const apiConfig = createServiceConfig('api', {
    DATABASE_URL: databaseUrl,
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    PROBLEMS_ROOT: problemsRoot,
    STORAGE_ROOT: storageRoot,
    RUNNER_MODE: 'local',
    ADMIN_USERNAME: adminUser,
    ADMIN_PASSWORD: adminPassword
  });
  const workerConfig = createServiceConfig('worker', {
    DATABASE_URL: databaseUrl,
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    PROBLEMS_ROOT: problemsRoot,
    STORAGE_ROOT: storageRoot,
    RUNNER_MODE: 'local',
    ADMIN_USERNAME: adminUser,
    ADMIN_PASSWORD: adminPassword
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

    const createProblemResponse = await apiApp.inject({
      method: 'POST',
      url: '/admin/problems',
      headers: {
        authorization: basicAuthHeader()
      },
      payload: {
        id: 'admin-sum',
        title: 'Admin Sum',
        description: 'official run demo'
      }
    });

    const publishVersionResponse = await apiApp.inject({
      method: 'POST',
      url: '/admin/problems/admin-sum/versions',
      headers: {
        authorization: basicAuthHeader()
      },
      payload: {
        bundle_path: bundleDir
      }
    });

    const registerA = await apiApp.inject({
      method: 'POST',
      url: '/api/agents/register',
      payload: { name: 'official-a' }
    });
    const registerB = await apiApp.inject({
      method: 'POST',
      url: '/api/agents/register',
      payload: { name: 'official-b' }
    });
    const tokenA = registerA.json<{ token: string }>().token;
    const tokenB = registerB.json<{ token: string }>().token;

    const perfectZip = await createSubmissionZipBase64(
      workspaceRoot,
      "payload['a'] + payload['b']",
      'perfect'
    );
    const heldoutOnlyZip = await createSubmissionZipBase64(
      workspaceRoot,
      "(payload['a'] + payload['b']) if payload['a'] not in (10, 99) else 0",
      'heldout-only'
    );

    await apiApp.inject({
      method: 'POST',
      url: '/api/submissions',
      headers: {
        authorization: `Bearer ${tokenA}`
      },
      payload: {
        problem_id: 'admin-sum',
        artifact_base64: perfectZip,
        explanation: 'best hidden score'
      }
    });
    await runWorkerCycle({
      config: workerConfig,
      db,
      logger: createLogger(workerConfig, {}, { enabled: false })
    });

    const submissionBResponse = await apiApp.inject({
      method: 'POST',
      url: '/api/submissions',
      headers: {
        authorization: `Bearer ${tokenB}`
      },
      payload: {
        problem_id: 'admin-sum',
        artifact_base64: heldoutOnlyZip,
        explanation: 'passes heldout only'
      }
    });
    const submissionBId = submissionBResponse.json<{ id: string }>().id;
    await runWorkerCycle({
      config: workerConfig,
      db,
      logger: createLogger(workerConfig, {}, { enabled: false })
    });

    const officialRunResponse = await apiApp.inject({
      method: 'POST',
      url: `/admin/submissions/${submissionBId}/official-run`,
      headers: {
        authorization: basicAuthHeader()
      },
      payload: {}
    });
    await runWorkerCycle({
      config: workerConfig,
      db,
      logger: createLogger(workerConfig, {}, { enabled: false })
    });

    const publicSubmission = await apiApp.inject({
      method: 'GET',
      url: `/api/public/submissions/${submissionBId}`
    });
    const publicSubmissionBody = publicSubmission.json<{
      public_evaluation: { hidden_summary: { score: number } };
      official_evaluation: { official_summary: { score: number } };
    }>();

    const leaderboardResponse = await apiApp.inject({
      method: 'GET',
      url: '/api/public/problems/admin-sum/leaderboard'
    });
    const leaderboardBody = leaderboardResponse.json<{
      items: Array<{ agent_name: string; best_hidden_score: number; official_score: number | null }>;
    }>();

    const jobRows = await queryRows<{ eval_type: string; status: string }>(
      db,
      `
        SELECT eval_type, status
        FROM evaluation_jobs
        WHERE submission_id = $1
        ORDER BY created_at ASC
      `,
      [submissionBId]
    );

    console.log(
      JSON.stringify(
        {
          createProblemStatusCode: createProblemResponse.statusCode,
          publishVersionStatusCode: publishVersionResponse.statusCode,
          officialRunStatusCode: officialRunResponse.statusCode,
          submissionPublicHiddenScore: publicSubmissionBody.public_evaluation.hidden_summary.score,
          submissionOfficialScore:
            publicSubmissionBody.official_evaluation.official_summary.score,
          leaderboardOrder: leaderboardBody.items.map((item) => item.agent_name),
          leaderboardHiddenScores: leaderboardBody.items.map((item) => item.best_hidden_score),
          leaderboardOfficialScores: leaderboardBody.items.map((item) => item.official_score),
          evaluationJobs: jobRows
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
    await rm(problemsRoot, { force: true, recursive: true });
    await rm(bundleRoot, { force: true, recursive: true });
  }
}

void main();
