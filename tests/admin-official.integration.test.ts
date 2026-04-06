import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
const sampleBundleRoot = path.resolve(
  process.cwd(),
  'examples/problems/sample-sum/v1'
);
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

describe('admin official run flow', () => {
  let storageRoot = '';
  let workspaceRoot = '';
  let problemsRoot = '';
  let bundleRoot = '';
  let bundleDir = '';
  const apiConfig = createServiceConfig('api', {
    DATABASE_URL: databaseUrl,
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    PROBLEMS_ROOT: 'placeholder',
    STORAGE_ROOT: 'placeholder',
    RUNNER_MODE: 'local',
    ADMIN_USERNAME: adminUser,
    ADMIN_PASSWORD: adminPassword
  });
  const workerConfig = createServiceConfig('worker', {
    DATABASE_URL: databaseUrl,
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    PROBLEMS_ROOT: 'placeholder',
    STORAGE_ROOT: 'placeholder',
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
  const workerLogger = createLogger(workerConfig, {}, { enabled: false });

  beforeAll(async () => {
    storageRoot = await mkdtemp(
      path.join(os.tmpdir(), 'llm-oj-admin-storage-')
    );
    workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), 'llm-oj-admin-workspace-')
    );
    problemsRoot = await mkdtemp(
      path.join(os.tmpdir(), 'llm-oj-admin-problems-')
    );
    bundleRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-oj-admin-bundle-'));
    bundleDir = await createAdminBundle(bundleRoot);

    Object.assign(apiConfig.env, {
      STORAGE_ROOT: storageRoot,
      PROBLEMS_ROOT: problemsRoot
    });
    Object.assign(workerConfig.env, {
      STORAGE_ROOT: storageRoot,
      PROBLEMS_ROOT: problemsRoot
    });

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
  }, 60_000);

  afterAll(async () => {
    await apiApp.close();
    await db.end();
    await rm(storageRoot, { force: true, recursive: true });
    await rm(workspaceRoot, { force: true, recursive: true });
    await rm(problemsRoot, { force: true, recursive: true });
    await rm(bundleRoot, { force: true, recursive: true });
  }, 60_000);

  it('creates problems, runs official eval, rejudges, hides submissions and disables agents', async () => {
    const unauthorizedPage = await apiApp.inject({
      method: 'GET',
      url: '/admin'
    });
    expect(unauthorizedPage.statusCode).toBe(401);

    const adminPage = await apiApp.inject({
      method: 'GET',
      url: '/admin',
      headers: {
        authorization: basicAuthHeader()
      }
    });
    expect(adminPage.statusCode).toBe(200);
    expect(adminPage.body).toContain('Admin Console');

    const createProblemResponse = await apiApp.inject({
      method: 'POST',
      url: '/admin/problems',
      headers: {
        authorization: basicAuthHeader()
      },
      payload: {
        id: 'admin-sum',
        title: 'Admin Sum',
        description: 'official flow test'
      }
    });
    expect(createProblemResponse.statusCode).toBe(201);

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
    expect(publishVersionResponse.statusCode).toBe(201);

    const registerA = await apiApp.inject({
      method: 'POST',
      url: '/api/agents/register',
      payload: { name: 'admin-agent-a' }
    });
    const registerB = await apiApp.inject({
      method: 'POST',
      url: '/api/agents/register',
      payload: { name: 'admin-agent-b' }
    });
    const registerABody = registerA.json<{ token: string }>();
    const registerBBody = registerB.json<{ token: string; agent_id: string }>();

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

    const submissionAResponse = await apiApp.inject({
      method: 'POST',
      url: '/api/submissions',
      headers: {
        authorization: `Bearer ${registerABody.token}`
      },
      payload: {
        problem_id: 'admin-sum',
        artifact_base64: perfectZip,
        explanation: 'best hidden score'
      }
    });
    const submissionAId = submissionAResponse.json<{ id: string }>().id;
    await runWorkerCycle({ config: workerConfig, db, logger: workerLogger });

    const submissionBResponse = await apiApp.inject({
      method: 'POST',
      url: '/api/submissions',
      headers: {
        authorization: `Bearer ${registerBBody.token}`
      },
      payload: {
        problem_id: 'admin-sum',
        artifact_base64: heldoutOnlyZip,
        explanation: 'passes heldout only'
      }
    });
    const submissionBId = submissionBResponse.json<{ id: string }>().id;
    await runWorkerCycle({ config: workerConfig, db, logger: workerLogger });

    const leaderboardBeforeOfficial = await apiApp.inject({
      method: 'GET',
      url: '/api/public/problems/admin-sum/leaderboard'
    });
    const leaderboardBeforeBody = leaderboardBeforeOfficial.json<{
      items: Array<{
        agent_name: string;
        best_hidden_score: number;
        official_score: number | null;
      }>;
    }>();
    expect(leaderboardBeforeOfficial.statusCode).toBe(200);
    expect(leaderboardBeforeBody.items.map((item) => item.agent_name)).toEqual([
      'admin-agent-a',
      'admin-agent-b'
    ]);
    expect(
      leaderboardBeforeBody.items.map((item) => item.best_hidden_score)
    ).toEqual([1, 0]);
    expect(
      leaderboardBeforeBody.items.map((item) => item.official_score)
    ).toEqual([null, null]);

    const officialRunResponse = await apiApp.inject({
      method: 'POST',
      url: `/admin/submissions/${submissionBId}/official-run`,
      headers: {
        authorization: basicAuthHeader()
      },
      payload: {}
    });
    expect(officialRunResponse.statusCode).toBe(202);

    const officialJobs = await queryRows<{ eval_type: string; status: string }>(
      db,
      `
        SELECT eval_type, status
        FROM evaluation_jobs
        WHERE submission_id = $1
        ORDER BY created_at ASC
      `,
      [submissionBId]
    );
    expect(officialJobs).toEqual([
      { eval_type: 'public', status: 'completed' },
      { eval_type: 'official', status: 'queued' }
    ]);

    await runWorkerCycle({ config: workerConfig, db, logger: workerLogger });

    const publicSubmissionAfterOfficial = await apiApp.inject({
      method: 'GET',
      url: `/api/public/submissions/${submissionBId}`
    });
    const publicSubmissionAfterOfficialBody =
      publicSubmissionAfterOfficial.json<{
        public_evaluation: { hidden_summary: { score: number } };
        official_evaluation: { official_summary: { score: number } };
      }>();
    expect(publicSubmissionAfterOfficial.statusCode).toBe(200);
    expect(
      publicSubmissionAfterOfficialBody.public_evaluation.hidden_summary.score
    ).toBe(0);
    expect(
      publicSubmissionAfterOfficialBody.official_evaluation.official_summary
        .score
    ).toBe(1);

    const leaderboardAfterOfficial = await apiApp.inject({
      method: 'GET',
      url: '/api/public/problems/admin-sum/leaderboard'
    });
    const leaderboardAfterBody = leaderboardAfterOfficial.json<{
      items: Array<{
        agent_name: string;
        best_hidden_score: number;
        official_score: number | null;
      }>;
    }>();
    expect(leaderboardAfterBody.items.map((item) => item.agent_name)).toEqual([
      'admin-agent-a',
      'admin-agent-b'
    ]);
    expect(
      leaderboardAfterBody.items.map((item) => item.best_hidden_score)
    ).toEqual([1, 0]);
    expect(leaderboardAfterBody.items[1]?.official_score).toBe(1);

    const submissionPage = await apiApp.inject({
      method: 'GET',
      url: `/submissions/${submissionBId}`
    });
    expect(submissionPage.statusCode).toBe(200);
    expect(submissionPage.body).toContain('Official Score');
    expect(submissionPage.body).toContain('official evaluation');
    expect(submissionPage.body).toContain('official dataset summary');

    const rejudgeResponse = await apiApp.inject({
      method: 'POST',
      url: `/admin/submissions/${submissionBId}/rejudge`,
      headers: {
        authorization: basicAuthHeader()
      },
      payload: {}
    });
    expect(rejudgeResponse.statusCode).toBe(202);

    const hiddenDuringRejudge = await apiApp.inject({
      method: 'GET',
      url: `/api/public/submissions/${submissionBId}`
    });
    expect(hiddenDuringRejudge.statusCode).toBe(404);

    await runWorkerCycle({ config: workerConfig, db, logger: workerLogger });

    const publicSubmissionAfterRejudge = await apiApp.inject({
      method: 'GET',
      url: `/api/public/submissions/${submissionBId}`
    });
    const publicSubmissionAfterRejudgeBody = publicSubmissionAfterRejudge.json<{
      public_evaluation: { hidden_summary: { score: number } };
      official_evaluation: { official_summary: { score: number } };
    }>();
    expect(publicSubmissionAfterRejudge.statusCode).toBe(200);
    expect(
      publicSubmissionAfterRejudgeBody.public_evaluation.hidden_summary.score
    ).toBe(0);
    expect(
      publicSubmissionAfterRejudgeBody.official_evaluation.official_summary
        .score
    ).toBe(1);

    const hideResponse = await apiApp.inject({
      method: 'POST',
      url: `/admin/submissions/${submissionAId}/hide`,
      headers: {
        authorization: basicAuthHeader()
      },
      payload: {}
    });
    expect(hideResponse.statusCode).toBe(200);

    const hiddenSubmissionA = await apiApp.inject({
      method: 'GET',
      url: `/api/public/submissions/${submissionAId}`
    });
    expect(hiddenSubmissionA.statusCode).toBe(404);

    const leaderboardAfterHide = await apiApp.inject({
      method: 'GET',
      url: '/api/public/problems/admin-sum/leaderboard'
    });
    const leaderboardAfterHideBody = leaderboardAfterHide.json<{
      items: Array<{ agent_name: string; best_submission_id: string }>;
    }>();
    expect(leaderboardAfterHideBody.items).toHaveLength(1);
    expect(leaderboardAfterHideBody.items[0]?.agent_name).toBe('admin-agent-b');
    expect(leaderboardAfterHideBody.items[0]?.best_submission_id).toBe(
      submissionBId
    );

    const disableResponse = await apiApp.inject({
      method: 'POST',
      url: `/admin/agents/${registerBBody.agent_id}/disable`,
      headers: {
        authorization: basicAuthHeader()
      },
      payload: {}
    });
    expect(disableResponse.statusCode).toBe(200);

    const disabledAgentAccess = await apiApp.inject({
      method: 'GET',
      url: '/api/problems',
      headers: {
        authorization: `Bearer ${registerBBody.token}`
      }
    });
    expect(disabledAgentAccess.statusCode).toBe(401);
  }, 60_000);
});
