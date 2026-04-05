import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

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
  expression: string
): Promise<string> {
  const sourceDir = path.join(workspaceRoot, `submission-${expression.replaceAll(/[^a-z]/gi, '')}`);
  const zipPath = path.join(workspaceRoot, `${expression.replaceAll(/[^a-z]/gi, '')}.zip`);

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

describe('public read APIs and pages', () => {
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

  beforeAll(async () => {
    storageRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-oj-public-read-storage-'));
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-oj-public-read-workspace-'));
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

  it('keeps submissions private before eval and exposes them after eval, with leaderboard ordering', async () => {
    const agentA = await request(apiApp.server).post('/api/agents/register').send({ name: 'leader-a' });
    const agentB = await request(apiApp.server).post('/api/agents/register').send({ name: 'leader-b' });
    const tokenA = (agentA.body as { token: string }).token;
    const tokenB = (agentB.body as { token: string }).token;
    const goodArtifact = await createSubmissionZipBase64(workspaceRoot, "payload['a'] + payload['b']");
    const badArtifact = await createSubmissionZipBase64(workspaceRoot, "payload['a'] - payload['b']");

    const pendingResponse = await request(apiApp.server)
      .post('/api/submissions')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        problem_id: 'sample-sum',
        artifact_base64: goodArtifact,
        explanation: 'perfect score'
      });
    const pendingId = (pendingResponse.body as { id: string }).id;

    const hiddenBefore = await request(apiApp.server).get(`/api/public/submissions/${pendingId}`);
    expect(hiddenBefore.status).toBe(404);

    await runWorkerCycle({
      config: workerConfig,
      db,
      logger: createLogger(workerConfig, {}, { enabled: false })
    });

    const secondResponse = await request(apiApp.server)
      .post('/api/submissions')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        problem_id: 'sample-sum',
        artifact_base64: badArtifact,
        explanation: 'bad score'
      });

    await runWorkerCycle({
      config: workerConfig,
      db,
      logger: createLogger(workerConfig, {}, { enabled: false })
    });

    const publicSubmission = await request(apiApp.server).get(`/api/public/submissions/${pendingId}`);
    const publicSubmissionBody = publicSubmission.body as { visible_after_eval: boolean };
    expect(publicSubmission.status).toBe(200);
    expect(publicSubmissionBody.visible_after_eval).toBe(true);

    const leaderboardResponse = await request(apiApp.server).get(
      '/api/public/problems/sample-sum/leaderboard'
    );
    const leaderboardBody = leaderboardResponse.body as {
      items: Array<{
        agent_name: string;
        best_hidden_score: number;
      }>;
    };
    expect(leaderboardResponse.status).toBe(200);
    expect(leaderboardBody.items).toHaveLength(2);
    const firstItem = leaderboardBody.items[0];
    const secondItem = leaderboardBody.items[1];
    expect(firstItem).toBeDefined();
    expect(secondItem).toBeDefined();
    expect(firstItem?.agent_name).toBe('leader-a');
    expect(firstItem?.best_hidden_score).toBe(1);
    expect(secondItem?.agent_name).toBe('leader-b');
    expect(secondItem?.best_hidden_score).toBe(0);

    const problemPage = await request(apiApp.server).get('/problems/sample-sum');
    const submissionPage = await request(apiApp.server).get(`/submissions/${pendingId}`);
    const leaderboardPage = await request(apiApp.server).get('/problems/sample-sum/leaderboard');

    expect(problemPage.status).toBe(200);
    expect(problemPage.text).toContain('Sample Sum');
    expect(submissionPage.status).toBe(200);
    expect(submissionPage.text).toContain(pendingId);
    expect(leaderboardPage.status).toBe(200);
    expect(leaderboardPage.text).toContain('leader-a');

    expect(secondResponse.status).toBe(201);
  });

  it('creates and lists discussion threads and replies', async () => {
    const registerResponse = await request(apiApp.server).post('/api/agents/register').send({
      name: 'discussion-agent'
    });
    const token = (registerResponse.body as { token: string }).token;

    const threadResponse = await request(apiApp.server)
      .post('/api/problems/sample-sum/discussions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'How to improve score?',
        body: 'I think the hidden cases are all integer addition.'
      });
    const threadId = (threadResponse.body as { id: string }).id;

    const replyResponse = await request(apiApp.server)
      .post(`/api/discussions/${threadId}/replies`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        body: 'Confirmed, public cases follow the same pattern.'
      });

    expect(threadResponse.status).toBe(201);
    expect(replyResponse.status).toBe(201);

    const discussionsResponse = await request(apiApp.server).get(
      '/api/public/problems/sample-sum/discussions'
    );
    const discussionsBody = discussionsResponse.body as {
      items: Array<{
        title: string;
        replies: Array<{ id: string }>;
      }>;
    };
    expect(discussionsResponse.status).toBe(200);
    const firstDiscussion = discussionsBody.items[0];
    expect(firstDiscussion).toBeDefined();
    expect(firstDiscussion?.title).toBe('How to improve score?');
    expect(firstDiscussion?.replies).toHaveLength(1);

    const discussionPage = await request(apiApp.server).get('/problems/sample-sum/discussions');
    expect(discussionPage.status).toBe(200);
    expect(discussionPage.text).toContain('How to improve score?');
  });
});
