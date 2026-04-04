import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';

import type { Pool } from 'pg';

import {
  type ProblemBundleSpec,
  hashAgentToken,
  validateProblemBundle
} from '@llm-oj/shared';

export interface AgentRecord {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly owner: string;
  readonly modelInfo: Record<string, unknown>;
  readonly status: string;
  readonly createdAt: string;
}

export interface AuthenticatedAgent {
  readonly agentId: string;
  readonly tokenId: string;
  readonly name: string;
}

export interface RegisterAgentInput {
  readonly agentId: string;
  readonly tokenId: string;
  readonly token: string;
  readonly name: string;
  readonly description: string;
  readonly owner: string;
  readonly modelInfo: Record<string, unknown>;
}

export interface ProblemVersionRecord {
  readonly problemId: string;
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly problemVersionId: string;
  readonly version: string;
  readonly bundlePath: string;
  readonly statementPath: string;
  readonly specJson: ProblemBundleSpec;
}

export interface CreateSubmissionInput {
  readonly submissionId: string;
  readonly jobId: string;
  readonly agentId: string;
  readonly problemId: string;
  readonly artifactPath: string;
  readonly explanation: string;
  readonly parentSubmissionId: string | null;
  readonly creditText: string;
}

export interface SubmissionRecord {
  readonly id: string;
  readonly problemId: string;
  readonly problemVersionId: string;
  readonly agentId: string;
  readonly artifactPath: string;
  readonly language: string;
  readonly status: string;
  readonly explanation: string;
  readonly parentSubmissionId: string | null;
  readonly creditText: string;
  readonly visibleAfterEval: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly evaluationJobId: string | null;
  readonly evaluationJobStatus: string | null;
}

function mapProblemVersionRow(row: {
  problem_id: string;
  slug: string;
  title: string;
  description: string;
  problem_version_id: string;
  version: string;
  bundle_path: string;
  statement_path: string;
  spec_json: ProblemBundleSpec;
}): ProblemVersionRecord {
  return {
    problemId: row.problem_id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    problemVersionId: row.problem_version_id,
    version: row.version,
    bundlePath: row.bundle_path,
    statementPath: row.statement_path,
    specJson: row.spec_json
  };
}

export async function registerAgent(pool: Pool, input: RegisterAgentInput): Promise<AgentRecord> {
  const tokenHash = hashAgentToken(input.token);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const agentResult = await client.query<{
      id: string;
      name: string;
      description: string;
      owner: string;
      model_info: Record<string, unknown>;
      status: string;
      created_at: string;
    }>(
      `
        INSERT INTO agents (id, name, description, owner, model_info, status)
        VALUES ($1, $2, $3, $4, $5::jsonb, 'active')
        RETURNING id, name, description, owner, model_info, status, created_at
      `,
      [
        input.agentId,
        input.name,
        input.description,
        input.owner,
        JSON.stringify(input.modelInfo)
      ]
    );

    await client.query(
      `
        INSERT INTO agent_tokens (id, agent_id, token_hash)
        VALUES ($1, $2, $3)
      `,
      [input.tokenId, input.agentId, tokenHash]
    );

    await client.query('COMMIT');

    const row = agentResult.rows[0];
    if (!row) {
      throw new Error('创建 agent 后未返回记录');
    }

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      owner: row.owner,
      modelInfo: row.model_info,
      status: row.status,
      createdAt: row.created_at
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function authenticateAgentToken(
  pool: Pool,
  token: string
): Promise<AuthenticatedAgent | null> {
  const tokenHash = hashAgentToken(token);
  const result = await pool.query<{
    agent_id: string;
    token_id: string;
    name: string;
  }>(
    `
      SELECT a.id AS agent_id, t.id AS token_id, a.name
      FROM agent_tokens t
      JOIN agents a ON a.id = t.agent_id
      WHERE t.token_hash = $1
        AND t.revoked_at IS NULL
        AND a.status = 'active'
      LIMIT 1
    `,
    [tokenHash]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  await pool.query(`UPDATE agent_tokens SET last_used_at = NOW() WHERE id = $1`, [row.token_id]);

  return {
    agentId: row.agent_id,
    tokenId: row.token_id,
    name: row.name
  };
}

export async function listPublishedProblems(pool: Pool): Promise<ProblemVersionRecord[]> {
  const result = await pool.query<{
    problem_id: string;
    slug: string;
    title: string;
    description: string;
    problem_version_id: string;
    version: string;
    bundle_path: string;
    statement_path: string;
    spec_json: ProblemBundleSpec;
  }>(
    `
      SELECT
        p.id AS problem_id,
        p.slug,
        p.title,
        p.description,
        pv.id AS problem_version_id,
        pv.version,
        pv.bundle_path,
        pv.statement_path,
        pv.spec_json
      FROM problems p
      JOIN LATERAL (
        SELECT id, version, bundle_path, statement_path, spec_json
        FROM problem_versions
        WHERE problem_id = p.id
          AND status = 'published'
        ORDER BY created_at DESC
        LIMIT 1
      ) pv ON TRUE
      WHERE p.status = 'active'
      ORDER BY p.created_at ASC
    `
  );

  return result.rows.map((row) => mapProblemVersionRow(row));
}

export async function getPublishedProblem(
  pool: Pool,
  problemIdOrSlug: string
): Promise<ProblemVersionRecord | null> {
  const result = await pool.query<{
    problem_id: string;
    slug: string;
    title: string;
    description: string;
    problem_version_id: string;
    version: string;
    bundle_path: string;
    statement_path: string;
    spec_json: ProblemBundleSpec;
  }>(
    `
      SELECT
        p.id AS problem_id,
        p.slug,
        p.title,
        p.description,
        pv.id AS problem_version_id,
        pv.version,
        pv.bundle_path,
        pv.statement_path,
        pv.spec_json
      FROM problems p
      JOIN LATERAL (
        SELECT id, version, bundle_path, statement_path, spec_json
        FROM problem_versions
        WHERE problem_id = p.id
          AND status = 'published'
        ORDER BY created_at DESC
        LIMIT 1
      ) pv ON TRUE
      WHERE p.status = 'active'
        AND (p.id = $1 OR p.slug = $1)
      LIMIT 1
    `,
    [problemIdOrSlug]
  );

  const row = result.rows[0];
  return row ? mapProblemVersionRow(row) : null;
}

export async function ensureProblemsSeededFromRoot(
  pool: Pool,
  problemsRoot: string
): Promise<number> {
  await mkdir(problemsRoot, { recursive: true });
  const problemSlugs = await readdir(problemsRoot, { withFileTypes: true });
  let syncedCount = 0;

  for (const slugEntry of problemSlugs) {
    if (!slugEntry.isDirectory()) {
      continue;
    }

    const slugRoot = path.join(problemsRoot, slugEntry.name);
    const versionEntries = await readdir(slugRoot, { withFileTypes: true });

    for (const versionEntry of versionEntries) {
      if (!versionEntry.isDirectory()) {
        continue;
      }

      const bundleDir = path.join(slugRoot, versionEntry.name);
      if (!existsSync(path.join(bundleDir, 'spec.json'))) {
        continue;
      }

      const validated = await validateProblemBundle(bundleDir);
      const problemId = validated.spec.problem_id;
      const versionId = `${problemId}:${validated.spec.problem_version}`;

      await pool.query(
        `
          INSERT INTO problems (id, slug, title, description, status)
          VALUES ($1, $2, $3, '', 'active')
          ON CONFLICT (id) DO UPDATE
          SET slug = EXCLUDED.slug,
              title = EXCLUDED.title,
              status = 'active',
              updated_at = NOW()
        `,
        [problemId, problemId, validated.spec.problem_title]
      );

      await pool.query(
        `
          INSERT INTO problem_versions (
            id,
            problem_id,
            version,
            bundle_path,
            statement_path,
            spec_json,
            status
          )
          VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'published')
          ON CONFLICT (problem_id, version) DO UPDATE
          SET bundle_path = EXCLUDED.bundle_path,
              statement_path = EXCLUDED.statement_path,
              spec_json = EXCLUDED.spec_json,
              status = 'published'
        `,
        [
          versionId,
          problemId,
          validated.spec.problem_version,
          bundleDir,
          validated.paths.statementPath,
          JSON.stringify(validated.spec)
        ]
      );

      syncedCount += 1;
    }
  }

  return syncedCount;
}

export async function storeSubmissionArtifact(
  storageRoot: string,
  submissionId: string,
  artifactBuffer: Buffer
): Promise<string> {
  const submissionsDir = path.join(storageRoot, 'submissions');
  const artifactPath = path.join(submissionsDir, `${submissionId}.zip`);

  await mkdir(submissionsDir, { recursive: true });
  await writeFile(artifactPath, artifactBuffer);

  return artifactPath;
}

export async function createSubmissionWithJob(
  pool: Pool,
  input: CreateSubmissionInput
): Promise<SubmissionRecord> {
  const problem = await getPublishedProblem(pool, input.problemId);

  if (!problem) {
    throw new Error(`problem not found: ${input.problemId}`);
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const submissionResult = await client.query<{
      id: string;
      problem_id: string;
      problem_version_id: string;
      agent_id: string;
      artifact_path: string;
      language: string;
      status: string;
      explanation: string;
      parent_submission_id: string | null;
      credit_text: string;
      visible_after_eval: boolean;
      created_at: string;
      updated_at: string;
    }>(
      `
        INSERT INTO submissions (
          id,
          problem_id,
          problem_version_id,
          agent_id,
          artifact_path,
          language,
          status,
          explanation,
          parent_submission_id,
          credit_text,
          visible_after_eval
        )
        VALUES ($1, $2, $3, $4, $5, 'python', 'queued', $6, $7, $8, FALSE)
        RETURNING
          id,
          problem_id,
          problem_version_id,
          agent_id,
          artifact_path,
          language,
          status,
          explanation,
          parent_submission_id,
          credit_text,
          visible_after_eval,
          created_at,
          updated_at
      `,
      [
        input.submissionId,
        problem.problemId,
        problem.problemVersionId,
        input.agentId,
        input.artifactPath,
        input.explanation,
        input.parentSubmissionId,
        input.creditText
      ]
    );

    await client.query(
      `
        INSERT INTO evaluation_jobs (
          id,
          submission_id,
          problem_id,
          problem_version_id,
          eval_type,
          status,
          payload_json
        )
        VALUES ($1, $2, $3, $4, 'public', 'queued', $5::jsonb)
      `,
      [
        input.jobId,
        input.submissionId,
        problem.problemId,
        problem.problemVersionId,
        JSON.stringify({
          artifact_path: input.artifactPath,
          bundle_path: problem.bundlePath,
          problem_id: problem.problemId,
          problem_version_id: problem.problemVersionId
        })
      ]
    );

    await client.query('COMMIT');

    const row = submissionResult.rows[0];
    if (!row) {
      throw new Error('创建 submission 后未返回记录');
    }

    return {
      id: row.id,
      problemId: row.problem_id,
      problemVersionId: row.problem_version_id,
      agentId: row.agent_id,
      artifactPath: row.artifact_path,
      language: row.language,
      status: row.status,
      explanation: row.explanation,
      parentSubmissionId: row.parent_submission_id,
      creditText: row.credit_text,
      visibleAfterEval: row.visible_after_eval,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      evaluationJobId: input.jobId,
      evaluationJobStatus: 'queued'
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function getSubmissionById(
  pool: Pool,
  submissionId: string
): Promise<SubmissionRecord | null> {
  const result = await pool.query<{
    id: string;
    problem_id: string;
    problem_version_id: string;
    agent_id: string;
    artifact_path: string;
    language: string;
    status: string;
    explanation: string;
    parent_submission_id: string | null;
    credit_text: string;
    visible_after_eval: boolean;
    created_at: string;
    updated_at: string;
    evaluation_job_id: string | null;
    evaluation_job_status: string | null;
  }>(
    `
      SELECT
        s.id,
        s.problem_id,
        s.problem_version_id,
        s.agent_id,
        s.artifact_path,
        s.language,
        s.status,
        s.explanation,
        s.parent_submission_id,
        s.credit_text,
        s.visible_after_eval,
        s.created_at,
        s.updated_at,
        j.id AS evaluation_job_id,
        j.status AS evaluation_job_status
      FROM submissions s
      LEFT JOIN evaluation_jobs j ON j.submission_id = s.id
      WHERE s.id = $1
      ORDER BY j.created_at DESC NULLS LAST
      LIMIT 1
    `,
    [submissionId]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    problemId: row.problem_id,
    problemVersionId: row.problem_version_id,
    agentId: row.agent_id,
    artifactPath: row.artifact_path,
    language: row.language,
    status: row.status,
    explanation: row.explanation,
    parentSubmissionId: row.parent_submission_id,
    creditText: row.credit_text,
    visibleAfterEval: row.visible_after_eval,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    evaluationJobId: row.evaluation_job_id,
    evaluationJobStatus: row.evaluation_job_status
  };
}
