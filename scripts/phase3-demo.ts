import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  createDatabasePool,
  defaultMigrationsDir,
  queryRows,
  runMigrations
} from '@llm-oj/db';
import { createLogger, createServiceConfig } from '@llm-oj/shared';

import { createApiApp } from '../apps/api/src/app';

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://llm_oj:llm_oj@127.0.0.1:5432/llm_oj_test';
const problemsRoot = path.resolve(process.cwd(), 'examples/problems');
const emptyZipBase64 = Buffer.from([
  0x50, 0x4b, 0x05, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
]).toString('base64');

interface RegisterResponseBody {
  readonly agent_id: string;
  readonly token: string;
}

interface ProblemListResponseBody {
  readonly items: Array<{
    readonly id: string;
    readonly slug: string;
    readonly title: string;
    readonly description: string;
    readonly current_version: {
      readonly id: string;
      readonly version: string;
    };
  }>;
}

interface CreateSubmissionResponseBody {
  readonly id: string;
  readonly artifact_path: string;
  readonly status: string;
}

interface SubmissionStatusResponseBody {
  readonly id: string;
  readonly problem_id: string;
  readonly problem_version_id: string;
  readonly agent_id: string;
  readonly status: string;
  readonly explanation: string;
  readonly parent_submission_id: string | null;
  readonly credit_text: string;
  readonly visible_after_eval: boolean;
  readonly artifact_path: string;
  readonly evaluation_job: {
    readonly id: string;
    readonly status: string;
  };
}

function normalizeRegisterBody(body: RegisterResponseBody) {
  return {
    agent_id: '<generated-agent-id>',
    token_prefix: body.token.slice(0, 6),
    token_length: body.token.length,
    name: '<generated-agent-name>',
    created_at: '<generated-created-at>'
  };
}

function normalizeCreateSubmissionBody(body: CreateSubmissionResponseBody) {
  return {
    id: '<generated-submission-id>',
    status: body.status,
    problem_id: 'sample-sum',
    problem_version_id: 'sample-sum:v1',
    artifact_path: '<storage-root>/submissions/<generated-submission-id>.zip',
    evaluation_job_id: '<generated-job-id>',
    created_at: '<generated-created-at>'
  };
}

function normalizeSubmissionStatusBody(body: SubmissionStatusResponseBody) {
  return {
    id: '<generated-submission-id>',
    problem_id: body.problem_id,
    problem_version_id: body.problem_version_id,
    agent_id: '<generated-agent-id>',
    status: body.status,
    explanation: body.explanation,
    parent_submission_id: body.parent_submission_id,
    credit_text: body.credit_text,
    visible_after_eval: body.visible_after_eval,
    artifact_path: '<storage-root>/submissions/<generated-submission-id>.zip',
    evaluation_job: {
      id: '<generated-job-id>',
      status: body.evaluation_job.status
    },
    created_at: '<generated-created-at>',
    updated_at: '<generated-updated-at>'
  };
}

async function main(): Promise<void> {
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-oj-phase3-demo-'));
  const config = createServiceConfig('api', {
    DATABASE_URL: databaseUrl,
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    PROBLEMS_ROOT: problemsRoot,
    STORAGE_ROOT: storageRoot
  });
  const db = createDatabasePool(config);
  const app = createApiApp({
    config,
    db,
    logger: createLogger(config, {}, { enabled: false })
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
    await app.ready();

    const registerResponse = await app.inject({
      method: 'POST',
      url: '/api/agents/register',
      payload: {
        name: `showboat-agent-${randomUUID().slice(0, 8)}`
      }
    });
    const registerBody: RegisterResponseBody = registerResponse.json();
    const authHeaders = {
      authorization: `Bearer ${registerBody.token}`
    };

    const problemsResponse = await app.inject({
      method: 'GET',
      url: '/api/problems',
      headers: authHeaders
    });
    const problemsBody: ProblemListResponseBody = problemsResponse.json();

    const submissionResponse = await app.inject({
      method: 'POST',
      url: '/api/submissions',
      headers: authHeaders,
      payload: {
        problem_id: 'sample-sum',
        artifact_base64: emptyZipBase64,
        explanation: 'showboat demo submission'
      }
    });
    const submissionBody: CreateSubmissionResponseBody = submissionResponse.json();

    const submissionStatusResponse = await app.inject({
      method: 'GET',
      url: `/api/submissions/${submissionBody.id}`,
      headers: authHeaders
    });
    const submissionStatusBody: SubmissionStatusResponseBody = submissionStatusResponse.json();

    const storedArtifact = await readFile(submissionBody.artifact_path);
    const dbRows = await queryRows<{ id: string; status: string; artifact_path: string }>(
      db,
      `
        SELECT id, status, artifact_path
        FROM submissions
        WHERE id = $1
      `,
      [submissionBody.id]
    );

    console.log(
      JSON.stringify(
        {
          register: {
            statusCode: registerResponse.statusCode,
            body: normalizeRegisterBody(registerBody)
          },
          problems: {
            statusCode: problemsResponse.statusCode,
            body: problemsBody
          },
          createSubmission: {
            statusCode: submissionResponse.statusCode,
            body: normalizeCreateSubmissionBody(submissionBody)
          },
          getSubmission: {
            statusCode: submissionStatusResponse.statusCode,
            body: normalizeSubmissionStatusBody(submissionStatusBody)
          },
          artifactMagic: storedArtifact.subarray(0, 4).toString('hex'),
          databaseRows: dbRows.map((row) => ({
            id: '<generated-submission-id>',
            status: row.status,
            artifact_path: '<storage-root>/submissions/<generated-submission-id>.zip'
          }))
        },
        null,
        2
      )
    );
  } finally {
    await app.close();
    await db.end();
    await rm(storageRoot, { force: true, recursive: true });
  }
}

void main();
