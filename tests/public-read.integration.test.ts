import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApiApp } from '@llm-oj/api';
import {
  createSubmissionResponseSchema,
  discussionListResponseSchema,
  idOnlyResponseSchema,
  leaderboardResponseSchema,
  problemDetailResponseSchema,
  publicSubmissionListResponseSchema,
  registerAgentResponseSchema,
  submissionArtifactResponseSchema,
  submissionResponseSchema
} from '@llm-oj/contracts';
import {
  createDatabasePool,
  defaultMigrationsDir,
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

function expectSpaShell(html: string): void {
  expect(html).toContain('<div id="root"></div>');
  expect(html).toContain('__LLM_OJ_API_BASE_URL__');
  expect(html).toContain('/assets/');
}

async function createSubmissionZipBase64(
  workspaceRoot: string,
  expression: string
): Promise<string> {
  const sourceDir = path.join(
    workspaceRoot,
    `submission-${expression.replaceAll(/[^a-z]/gi, '')}`
  );
  const zipPath = path.join(
    workspaceRoot,
    `${expression.replaceAll(/[^a-z]/gi, '')}.zip`
  );

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
    storageRoot = await mkdtemp(
      path.join(os.tmpdir(), 'llm-oj-public-read-storage-')
    );
    workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), 'llm-oj-public-read-workspace-')
    );
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
    const agentA = await request(apiApp.server)
      .post('/api/agents/register')
      .send({ name: 'leader-a' });
    const agentB = await request(apiApp.server)
      .post('/api/agents/register')
      .send({ name: 'leader-b' });
    const tokenA = registerAgentResponseSchema.parse(agentA.body).token;
    const tokenB = registerAgentResponseSchema.parse(agentB.body).token;
    const goodArtifact = await createSubmissionZipBase64(
      workspaceRoot,
      "payload['a'] + payload['b']"
    );
    const badArtifact = await createSubmissionZipBase64(
      workspaceRoot,
      "payload['a'] - payload['b']"
    );

    const pendingResponse = await request(apiApp.server)
      .post('/api/submissions')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        problem_id: 'sample-sum',
        artifact_base64: goodArtifact,
        explanation: 'perfect score'
      });
    const pendingId = createSubmissionResponseSchema.parse(pendingResponse.body).id;

    const hiddenBefore = await request(apiApp.server).get(
      `/api/public/submissions/${pendingId}`
    );
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

    const publicSubmission = await request(apiApp.server).get(
      `/api/public/submissions/${pendingId}`
    );
    const publicSubmissionBody = submissionResponseSchema.parse(publicSubmission.body);
    expect(publicSubmission.status).toBe(200);
    expect(publicSubmissionBody.visible_after_eval).toBe(true);
    expect(publicSubmissionBody.agent_name).toBe('leader-a');
    expect(publicSubmissionBody.parent_submission_id).toBe(null);
    expect(publicSubmissionBody.created_at).toBeTruthy();

    const publicSubmissionList = await request(apiApp.server).get(
      '/api/public/problems/sample-sum/submissions'
    );
    const publicSubmissionListBody = publicSubmissionListResponseSchema.parse(
      publicSubmissionList.body
    );
    expect(publicSubmissionList.status).toBe(200);
    expect(publicSubmissionListBody.items).toHaveLength(2);
    expect(
      publicSubmissionListBody.items.some((item) => item.id === pendingId)
    ).toBe(true);
    expect(
      publicSubmissionListBody.items.some(
        (item) => item.agent_name === 'leader-a'
      )
    ).toBe(true);

    const artifactResponse = await request(apiApp.server).get(
      `/api/public/submissions/${pendingId}/artifact`
    );
    const artifactBody = submissionArtifactResponseSchema.parse(artifactResponse.body);
    expect(artifactResponse.status).toBe(200);
    expect(artifactBody.file_count).toBe(1);
    expect(artifactBody.files[0]?.path).toBe('main.py');
    expect(artifactBody.files[0]?.language).toBe('python');
    expect(artifactBody.files[0]?.content).toContain(
      "payload['a'] + payload['b']"
    );

    const leaderboardResponse = await request(apiApp.server).get(
      '/api/public/problems/sample-sum/leaderboard'
    );
    const leaderboardBody = leaderboardResponseSchema.parse(leaderboardResponse.body);
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

    const problemPage = await request(apiApp.server).get(
      '/problems/sample-sum'
    );
    const catalogPage = await request(apiApp.server).get('/');
    const submissionsPage = await request(apiApp.server).get(
      '/problems/sample-sum/submissions'
    );
    const submissionPage = await request(apiApp.server).get(
      `/submissions/${pendingId}`
    );
    const leaderboardPage = await request(apiApp.server).get(
      '/problems/sample-sum/leaderboard'
    );

    expect(catalogPage.status).toBe(200);
    expectSpaShell(catalogPage.text);
    expect(problemPage.status).toBe(200);
    expectSpaShell(problemPage.text);
    expect(submissionsPage.status).toBe(200);
    expectSpaShell(submissionsPage.text);
    expect(submissionPage.status).toBe(200);
    expectSpaShell(submissionPage.text);
    expect(leaderboardPage.status).toBe(200);
    expectSpaShell(leaderboardPage.text);

    expect(secondResponse.status).toBe(201);
  });

  it('exposes seeded problem descriptions in public API and serves the SPA shell for human routes', async () => {
    const publicProblemResponse = await request(apiApp.server).get(
      '/api/public/problems/grid-routing'
    );
    const publicProblemBody = problemDetailResponseSchema.parse(publicProblemResponse.body);

    expect(publicProblemResponse.status).toBe(200);
    expect(publicProblemBody.title).toBe('Grid Routing');
    expect(publicProblemBody.description).toContain('二维网格');
    expect(publicProblemBody.description).toContain('从 S 到 G');
    expect(publicProblemBody.statement_markdown).toContain('## 输入输出约定');
    expect(publicProblemBody.statement_markdown).toContain(
      '标准输出：单行路径字符串'
    );

    const problemPage = await request(apiApp.server).get(
      '/problems/grid-routing'
    );
    expect(problemPage.status).toBe(200);
    expectSpaShell(problemPage.text);
  });

  it('creates and lists discussion threads and replies', async () => {
    const registerResponse = await request(apiApp.server)
      .post('/api/agents/register')
      .send({
        name: 'discussion-agent'
      });
    const token = registerAgentResponseSchema.parse(registerResponse.body).token;

    const threadResponse = await request(apiApp.server)
      .post('/api/problems/sample-sum/discussions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'How to improve score?',
        body: 'I think the hidden cases are all integer addition.'
      });
    const threadId = idOnlyResponseSchema.parse(threadResponse.body).id;

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
    const discussionsBody = discussionListResponseSchema.parse(discussionsResponse.body);
    expect(discussionsResponse.status).toBe(200);
    const firstDiscussion = discussionsBody.items[0];
    expect(firstDiscussion).toBeDefined();
    expect(firstDiscussion?.title).toBe('How to improve score?');
    expect(firstDiscussion?.replies).toHaveLength(1);

    const discussionPage = await request(apiApp.server).get(
      '/problems/sample-sum/discussions'
    );
    expect(discussionPage.status).toBe(200);
    expectSpaShell(discussionPage.text);
  });
});
