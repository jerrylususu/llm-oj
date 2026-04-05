import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { createApiApp } from '@llm-oj/api';
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
const iter1Dir = path.resolve(process.cwd(), 'examples/submissions/grid-routing-agent-iter-1');
const iter2Dir = path.resolve(process.cwd(), 'examples/submissions/grid-routing-agent-iter-2');

async function createSubmissionZipBase64(sourceDir: string, zipPath: string): Promise<string> {
  await execFileAsync(
    'uv',
    ['run', 'python', '-m', 'zipfile', '-c', zipPath, 'main.py'],
    { cwd: sourceDir }
  );
  const buffer = await readFile(zipPath);
  return buffer.toString('base64');
}

async function main(): Promise<void> {
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-oj-grid-routing-storage-'));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-oj-grid-routing-workspace-'));
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
      payload: { name: 'grid-routing-iter-agent' }
    });
    const registerBody: { token: string; agent_id: string } = registerResponse.json();
    const authHeaders = {
      authorization: `Bearer ${registerBody.token}`
    };

    const publicProblemResponse = await apiApp.inject({
      method: 'GET',
      url: '/api/public/problems/grid-routing'
    });
    const iter1Zip = path.join(workspaceRoot, 'iter1.zip');
    const iter2Zip = path.join(workspaceRoot, 'iter2.zip');
    const iter1Base64 = await createSubmissionZipBase64(iter1Dir, iter1Zip);
    const iter2Base64 = await createSubmissionZipBase64(iter2Dir, iter2Zip);

    const iter1Response = await apiApp.inject({
      method: 'POST',
      url: '/api/submissions',
      headers: authHeaders,
      payload: {
        problem_id: 'grid-routing',
        artifact_base64: iter1Base64,
        explanation: 'iter1: shortest path + deliberate bounce baseline'
      }
    });
    const iter1Body: { id: string } = iter1Response.json();
    await runWorkerCycle({
      config: workerConfig,
      db,
      logger: createLogger(workerConfig, {}, { enabled: false })
    });
    const iter1StatusResponse = await apiApp.inject({
      method: 'GET',
      url: `/api/submissions/${iter1Body.id}`,
      headers: authHeaders
    });
    const iter1StatusBody: {
      id: string;
      status: string;
      parent_submission_id: string | null;
      evaluation: {
        primary_score: number;
        hidden_summary: { score: number; passed: number; total: number };
      } | null;
    } = iter1StatusResponse.json();

    const iter2Response = await apiApp.inject({
      method: 'POST',
      url: '/api/submissions',
      headers: authHeaders,
      payload: {
        problem_id: 'grid-routing',
        artifact_base64: iter2Base64,
        explanation: 'iter2: lexicographic search for shorter, straighter routes',
        parent_submission_id: iter1Body.id
      }
    });
    const iter2Body: { id: string } = iter2Response.json();
    await runWorkerCycle({
      config: workerConfig,
      db,
      logger: createLogger(workerConfig, {}, { enabled: false })
    });
    const iter2StatusResponse = await apiApp.inject({
      method: 'GET',
      url: `/api/submissions/${iter2Body.id}`,
      headers: authHeaders
    });
    const iter2StatusBody: {
      id: string;
      status: string;
      parent_submission_id: string | null;
      evaluation: {
        primary_score: number;
        hidden_summary: { score: number; passed: number; total: number };
      } | null;
    } = iter2StatusResponse.json();

    const publicSubmissionResponse = await apiApp.inject({
      method: 'GET',
      url: `/api/public/submissions/${iter2Body.id}`
    });
    const leaderboardResponse = await apiApp.inject({
      method: 'GET',
      url: '/api/public/problems/grid-routing/leaderboard'
    });
    const leaderboardBody: {
      items: Array<{
        agent_name: string;
        best_submission_id: string;
        best_hidden_score: number;
      }>;
    } = leaderboardResponse.json();

    console.log(
      JSON.stringify(
        {
          publicProblemStatusCode: publicProblemResponse.statusCode,
          iter1: {
            createStatusCode: iter1Response.statusCode,
            id: iter1StatusBody.id,
            status: iter1StatusBody.status,
            parentSubmissionId: iter1StatusBody.parent_submission_id,
            primaryScore: iter1StatusBody.evaluation?.primary_score ?? null,
            hiddenSummary: iter1StatusBody.evaluation?.hidden_summary ?? null
          },
          iter2: {
            createStatusCode: iter2Response.statusCode,
            id: iter2StatusBody.id,
            status: iter2StatusBody.status,
            parentSubmissionId: iter2StatusBody.parent_submission_id,
            primaryScore: iter2StatusBody.evaluation?.primary_score ?? null,
            hiddenSummary: iter2StatusBody.evaluation?.hidden_summary ?? null
          },
          publicSubmissionStatusCode: publicSubmissionResponse.statusCode,
          leaderboardStatusCode: leaderboardResponse.statusCode,
          leaderboard: leaderboardBody.items
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
