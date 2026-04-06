import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

import {
  createDatabasePool,
  defaultMigrationsDir,
  queryRows,
  runMigrations
} from '@llm-oj/db';
import { createLogger, createServiceConfig } from '@llm-oj/shared';

import { createApiApp } from '../src/app';

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://llm_oj:llm_oj@127.0.0.1:5432/llm_oj_test';
const problemsRoot = path.resolve(process.cwd(), 'examples/problems');
const emptyZipBase64 = Buffer.from([
  0x50, 0x4b, 0x05, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
]).toString('base64');

interface RegisterAgentResponse {
  readonly agent_id: string;
  readonly token: string;
}

interface ProblemListResponse {
  readonly items: Array<{
    readonly id: string;
    readonly slug: string;
  }>;
}

interface ProblemDetailResponse {
  readonly current_version: {
    readonly version: string;
  };
}

interface CreateSubmissionResponse {
  readonly id: string;
  readonly status: string;
  readonly problem_id: string;
  readonly artifact_path: string;
}

interface SubmissionStatusResponse {
  readonly id: string;
  readonly status: string;
  readonly problem_id: string;
  readonly visible_after_eval: boolean;
  readonly evaluation_job: {
    readonly status: string;
  };
}

describe('agent registration and submissions', () => {
  let storageRoot = '';
  const config = createServiceConfig('api', {
    DATABASE_URL: databaseUrl,
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    PROBLEMS_ROOT: problemsRoot
  });
  const db = createDatabasePool(config);
  const app = createApiApp({
    config,
    db,
    logger: createLogger(config, {}, { enabled: false })
  });

  beforeAll(async () => {
    storageRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-oj-storage-'));
    Object.assign(config.env, { STORAGE_ROOT: storageRoot });

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
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await db.end();
    await rm(storageRoot, { force: true, recursive: true });
  });

  it('registers an agent and requires bearer auth for problem access', async () => {
    const registerResponse = await request(app.server)
      .post('/api/agents/register')
      .send({
        name: 'agent-alpha',
        description: 'first agent',
        owner: 'integration-suite',
        model_info: {
          provider: 'openai',
          model: 'gpt-test'
        }
      });
    const registerBody = registerResponse.body as RegisterAgentResponse;

    expect(registerResponse.status).toBe(201);
    expect(registerBody.agent_id).toBeTruthy();
    expect(registerBody.token).toMatch(/^llmoj_/);

    const unauthenticated = await request(app.server).get('/api/problems');
    expect(unauthenticated.status).toBe(401);

    const invalidToken = await request(app.server)
      .get('/api/problems')
      .set('Authorization', 'Bearer invalid-token');
    expect(invalidToken.status).toBe(401);

    const problemsResponse = await request(app.server)
      .get('/api/problems')
      .set('Authorization', `Bearer ${registerBody.token}`);
    const problemsBody = problemsResponse.body as ProblemListResponse;

    expect(problemsResponse.status).toBe(200);
    expect(problemsBody.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'sample-sum',
          slug: 'sample-sum'
        }),
        expect.objectContaining({
          id: 'grid-routing',
          slug: 'grid-routing'
        })
      ])
    );
  });

  it('creates a submission, persists the artifact and exposes submission status', async () => {
    const registerResponse = await request(app.server)
      .post('/api/agents/register')
      .send({
        name: 'agent-beta'
      });
    const registerBody = registerResponse.body as RegisterAgentResponse;
    const token = registerBody.token;

    const detailResponse = await request(app.server)
      .get('/api/problems/sample-sum')
      .set('Authorization', `Bearer ${token}`);
    const detailBody = detailResponse.body as ProblemDetailResponse;

    expect(detailResponse.status).toBe(200);
    expect(detailBody.current_version.version).toBe('v1');

    const invalidZipResponse = await request(app.server)
      .post('/api/submissions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        problem_id: 'sample-sum',
        artifact_base64: Buffer.from('not-a-zip', 'utf8').toString('base64')
      });

    expect(invalidZipResponse.status).toBe(400);

    const createResponse = await request(app.server)
      .post('/api/submissions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        problem_id: 'sample-sum',
        artifact_base64: emptyZipBase64,
        explanation: 'phase 3 integration test'
      });
    const createBody = createResponse.body as CreateSubmissionResponse;

    expect(createResponse.status).toBe(201);
    expect(createBody.status).toBe('queued');
    expect(createBody.problem_id).toBe('sample-sum');

    await access(createBody.artifact_path);
    const artifact = await readFile(createBody.artifact_path);
    expect(artifact.subarray(0, 4)).toEqual(
      Buffer.from([0x50, 0x4b, 0x05, 0x06])
    );

    const submissionResponse = await request(app.server)
      .get(`/api/submissions/${createBody.id}`)
      .set('Authorization', `Bearer ${token}`);
    const submissionBody = submissionResponse.body as SubmissionStatusResponse;

    expect(submissionResponse.status).toBe(200);
    expect(submissionBody).toMatchObject({
      id: createBody.id,
      status: 'queued',
      problem_id: 'sample-sum',
      visible_after_eval: false
    });
    expect(submissionBody.evaluation_job.status).toBe('queued');

    const dbRows = await queryRows<{ artifact_path: string; status: string }>(
      db,
      `
        SELECT artifact_path, status
        FROM submissions
        WHERE id = $1
      `,
      [createBody.id]
    );

    expect(dbRows).toEqual([
      {
        artifact_path: createBody.artifact_path,
        status: 'queued'
      }
    ]);
  });
});
