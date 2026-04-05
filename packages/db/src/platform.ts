import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';

import type { Pool } from 'pg';

import {
  type ProblemBundleSpec,
  hashAgentToken,
  shouldReplaceLeaderboardEntry,
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

export interface ProblemRecord {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateProblemInput {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly description: string;
}

export interface PublishProblemVersionInput {
  readonly problemId: string;
  readonly bundlePath: string;
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
  readonly evaluation: {
    readonly id: string;
    readonly status: string;
    readonly evalType: string;
    readonly primaryScore: number | null;
    readonly shownResults: unknown;
    readonly hiddenSummary: unknown;
    readonly officialSummary: unknown;
    readonly logPath: string | null;
    readonly startedAt: string | null;
    readonly finishedAt: string | null;
  } | null;
  readonly publicEvaluation: {
    readonly id: string;
    readonly status: string;
    readonly evalType: string;
    readonly primaryScore: number | null;
    readonly shownResults: unknown;
    readonly hiddenSummary: unknown;
    readonly officialSummary: unknown;
    readonly logPath: string | null;
    readonly startedAt: string | null;
    readonly finishedAt: string | null;
  } | null;
  readonly officialEvaluation: {
    readonly id: string;
    readonly status: string;
    readonly evalType: string;
    readonly primaryScore: number | null;
    readonly shownResults: unknown;
    readonly hiddenSummary: unknown;
    readonly officialSummary: unknown;
    readonly logPath: string | null;
    readonly startedAt: string | null;
    readonly finishedAt: string | null;
  } | null;
}

export interface EvaluationJobPayload {
  readonly artifact_path: string;
  readonly bundle_path: string;
  readonly problem_id: string;
  readonly problem_version_id: string;
}

export interface EvaluationJobRecord {
  readonly id: string;
  readonly submissionId: string;
  readonly problemId: string;
  readonly problemVersionId: string;
  readonly evalType: 'public' | 'official';
  readonly status: string;
  readonly attemptCount: number;
  readonly payload: EvaluationJobPayload;
}

export interface EvaluationResultInput {
  readonly evaluationId: string;
  readonly submissionId: string;
  readonly jobId: string;
  readonly evalType: 'public' | 'official';
}

export interface PersistedEvaluationResult extends EvaluationResultInput {
  readonly status: 'completed' | 'failed';
  readonly primaryScore: number | null;
  readonly shownResults: unknown;
  readonly hiddenSummary: unknown;
  readonly officialSummary: unknown;
  readonly logPath: string | null;
  readonly lastError: string | null;
}

export interface QueueEvaluationJobInput {
  readonly jobId: string;
  readonly submissionId: string;
  readonly evalType: 'public' | 'official';
}

export interface LeaderboardEntryRecord {
  readonly agentId: string;
  readonly agentName: string;
  readonly bestSubmissionId: string;
  readonly bestHiddenScore: number;
  readonly officialScore: number | null;
  readonly updatedAt: string;
}

export interface DiscussionReplyRecord {
  readonly id: string;
  readonly threadId: string;
  readonly agentId: string;
  readonly agentName: string;
  readonly body: string;
  readonly createdAt: string;
}

export interface DiscussionThreadRecord {
  readonly id: string;
  readonly problemId: string;
  readonly agentId: string;
  readonly agentName: string;
  readonly title: string;
  readonly body: string;
  readonly createdAt: string;
  readonly replies: DiscussionReplyRecord[];
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

function mapProblemRow(row: {
  id: string;
  slug: string;
  title: string;
  description: string;
  status: string;
  created_at: string;
  updated_at: string;
}): ProblemRecord {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function stripMarkdownInline(value: string): string {
  return value
    .replaceAll(/`([^`]+)`/g, '$1')
    .replaceAll(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replaceAll(/\*\*([^*]+)\*\*/g, '$1')
    .replaceAll(/\*([^*]+)\*/g, '$1')
    .replaceAll(/_([^_]+)_/g, '$1')
    .trim();
}

export async function extractProblemDescriptionFromStatement(statementPath: string): Promise<string> {
  const content = await readFile(statementPath, 'utf8');
  const lines = content.split(/\r?\n/);
  const paragraph: string[] = [];
  let inCodeBlock = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      continue;
    }

    if (!line) {
      if (paragraph.length > 0) {
        break;
      }
      continue;
    }

    if (
      line.startsWith('#') ||
      line.startsWith('-') ||
      /^\d+\.\s/.test(line) ||
      line.startsWith('>') ||
      line.startsWith('|')
    ) {
      if (paragraph.length > 0) {
        break;
      }
      continue;
    }

    paragraph.push(stripMarkdownInline(line));
  }

  return paragraph.join(' ').trim();
}

function mapEvaluationRow(row: {
  id: string | null;
  status: string | null;
  eval_type: string | null;
  primary_score: number | null;
  shown_results_json: unknown;
  hidden_summary_json: unknown;
  official_summary_json: unknown;
  log_path: string | null;
  started_at: string | null;
  finished_at: string | null;
}) {
  if (!row.id) {
    return null;
  }

  return {
    id: row.id,
    status: row.status ?? 'unknown',
    evalType: row.eval_type ?? 'public',
    primaryScore: row.primary_score,
    shownResults: row.shown_results_json,
    hiddenSummary: row.hidden_summary_json,
    officialSummary: row.official_summary_json,
    logPath: row.log_path,
    startedAt: row.started_at,
    finishedAt: row.finished_at
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

export async function createOrUpdateProblem(
  pool: Pool,
  input: CreateProblemInput
): Promise<ProblemRecord> {
  const result = await pool.query<{
    id: string;
    slug: string;
    title: string;
    description: string;
    status: string;
    created_at: string;
    updated_at: string;
  }>(
    `
      INSERT INTO problems (id, slug, title, description, status)
      VALUES ($1, $2, $3, $4, 'active')
      ON CONFLICT (id) DO UPDATE
      SET slug = EXCLUDED.slug,
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          status = 'active',
          updated_at = NOW()
      RETURNING id, slug, title, description, status, created_at, updated_at
    `,
    [input.id, input.slug, input.title, input.description]
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('创建 problem 后未返回记录');
  }

  return mapProblemRow(row);
}

export async function publishProblemVersion(
  pool: Pool,
  input: PublishProblemVersionInput
): Promise<ProblemVersionRecord> {
  const validated = await validateProblemBundle(input.bundlePath);
  const statementDescription = await extractProblemDescriptionFromStatement(
    validated.paths.statementPath
  );

  if (validated.spec.problem_id !== input.problemId) {
    throw new Error(
      `problem bundle id mismatch: expected ${input.problemId}, got ${validated.spec.problem_id}`
    );
  }

  const problemRows = await pool.query<{ id: string; slug: string; description: string }>(
    `
      SELECT id, slug, description
      FROM problems
      WHERE id = $1
      LIMIT 1
    `,
    [input.problemId]
  );
  const problem = problemRows.rows[0];

  if (!problem) {
    throw new Error(`problem not found: ${input.problemId}`);
  }

  const versionId = `${input.problemId}:${validated.spec.problem_version}`;
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
      WITH upserted_version AS (
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
        RETURNING id, problem_id, version, bundle_path, statement_path, spec_json
      )
      UPDATE problems p
      SET title = $7,
          description = CASE WHEN p.description = '' THEN $8 ELSE p.description END,
          status = 'active',
          updated_at = NOW()
      FROM upserted_version v
      WHERE p.id = v.problem_id
      RETURNING
        p.id AS problem_id,
        p.slug,
        p.title,
        p.description,
        v.id AS problem_version_id,
        v.version,
        v.bundle_path,
        v.statement_path,
        v.spec_json
    `,
    [
      versionId,
      input.problemId,
      validated.spec.problem_version,
      input.bundlePath,
      validated.paths.statementPath,
      JSON.stringify(validated.spec),
      validated.spec.problem_title,
      statementDescription
    ]
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('发布 problem version 后未返回记录');
  }

  return mapProblemVersionRow(row);
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
      const description = await extractProblemDescriptionFromStatement(validated.paths.statementPath);
      const problemId = validated.spec.problem_id;
      const versionId = `${problemId}:${validated.spec.problem_version}`;

      await pool.query(
        `
          INSERT INTO problems (id, slug, title, description, status)
          VALUES ($1, $2, $3, $4, 'active')
          ON CONFLICT (id) DO UPDATE
          SET slug = EXCLUDED.slug,
              title = EXCLUDED.title,
              description = CASE WHEN problems.description = '' THEN EXCLUDED.description ELSE problems.description END,
              status = 'active',
              updated_at = NOW()
        `,
        [problemId, problemId, validated.spec.problem_title, description]
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
      evaluationJobStatus: 'queued',
      evaluation: null,
      publicEvaluation: null,
      officialEvaluation: null
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
    latest_job_id: string | null;
    latest_job_status: string | null;
    public_evaluation_id: string | null;
    public_evaluation_status: string | null;
    public_evaluation_eval_type: string | null;
    public_evaluation_primary_score: number | null;
    public_shown_results_json: unknown;
    public_hidden_summary_json: unknown;
    public_official_summary_json: unknown;
    public_evaluation_log_path: string | null;
    public_evaluation_started_at: string | null;
    public_evaluation_finished_at: string | null;
    official_evaluation_id: string | null;
    official_evaluation_status: string | null;
    official_evaluation_eval_type: string | null;
    official_evaluation_primary_score: number | null;
    official_shown_results_json: unknown;
    official_hidden_summary_json: unknown;
    official_official_summary_json: unknown;
    official_evaluation_log_path: string | null;
    official_evaluation_started_at: string | null;
    official_evaluation_finished_at: string | null;
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
        j.id AS latest_job_id,
        j.status AS latest_job_status,
        pe.id AS public_evaluation_id,
        pe.status AS public_evaluation_status,
        pe.eval_type AS public_evaluation_eval_type,
        pe.primary_score AS public_evaluation_primary_score,
        pe.shown_results_json AS public_shown_results_json,
        pe.hidden_summary_json AS public_hidden_summary_json,
        pe.official_summary_json AS public_official_summary_json,
        pe.log_path AS public_evaluation_log_path,
        pe.started_at AS public_evaluation_started_at,
        pe.finished_at AS public_evaluation_finished_at,
        oe.id AS official_evaluation_id,
        oe.status AS official_evaluation_status,
        oe.eval_type AS official_evaluation_eval_type,
        oe.primary_score AS official_evaluation_primary_score,
        oe.shown_results_json AS official_shown_results_json,
        oe.hidden_summary_json AS official_hidden_summary_json,
        oe.official_summary_json AS official_official_summary_json,
        oe.log_path AS official_evaluation_log_path,
        oe.started_at AS official_evaluation_started_at,
        oe.finished_at AS official_evaluation_finished_at
      FROM submissions s
      LEFT JOIN LATERAL (
        SELECT id, status
        FROM evaluation_jobs
        WHERE submission_id = s.id
        ORDER BY created_at DESC
        LIMIT 1
      ) j ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          id,
          status,
          eval_type,
          primary_score,
          shown_results_json,
          hidden_summary_json,
          official_summary_json,
          log_path,
          started_at,
          finished_at
        FROM evaluations
        WHERE submission_id = s.id
          AND eval_type = 'public'
        ORDER BY created_at DESC
        LIMIT 1
      ) pe ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          id,
          status,
          eval_type,
          primary_score,
          shown_results_json,
          hidden_summary_json,
          official_summary_json,
          log_path,
          started_at,
          finished_at
        FROM evaluations
        WHERE submission_id = s.id
          AND eval_type = 'official'
        ORDER BY created_at DESC
        LIMIT 1
      ) oe ON TRUE
      WHERE s.id = $1
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
    evaluationJobId: row.latest_job_id,
    evaluationJobStatus: row.latest_job_status,
    evaluation:
      mapEvaluationRow({
        id: row.public_evaluation_id,
        status: row.public_evaluation_status,
        eval_type: row.public_evaluation_eval_type,
        primary_score: row.public_evaluation_primary_score,
        shown_results_json: row.public_shown_results_json,
        hidden_summary_json: row.public_hidden_summary_json,
        official_summary_json: row.public_official_summary_json,
        log_path: row.public_evaluation_log_path,
        started_at: row.public_evaluation_started_at,
        finished_at: row.public_evaluation_finished_at
      }) ??
      mapEvaluationRow({
        id: row.official_evaluation_id,
        status: row.official_evaluation_status,
        eval_type: row.official_evaluation_eval_type,
        primary_score: row.official_evaluation_primary_score,
        shown_results_json: row.official_shown_results_json,
        hidden_summary_json: row.official_hidden_summary_json,
        official_summary_json: row.official_official_summary_json,
        log_path: row.official_evaluation_log_path,
        started_at: row.official_evaluation_started_at,
        finished_at: row.official_evaluation_finished_at
      }),
    publicEvaluation: mapEvaluationRow({
      id: row.public_evaluation_id,
      status: row.public_evaluation_status,
      eval_type: row.public_evaluation_eval_type,
      primary_score: row.public_evaluation_primary_score,
      shown_results_json: row.public_shown_results_json,
      hidden_summary_json: row.public_hidden_summary_json,
      official_summary_json: row.public_official_summary_json,
      log_path: row.public_evaluation_log_path,
      started_at: row.public_evaluation_started_at,
      finished_at: row.public_evaluation_finished_at
    }),
    officialEvaluation: mapEvaluationRow({
      id: row.official_evaluation_id,
      status: row.official_evaluation_status,
      eval_type: row.official_evaluation_eval_type,
      primary_score: row.official_evaluation_primary_score,
      shown_results_json: row.official_shown_results_json,
      hidden_summary_json: row.official_hidden_summary_json,
      official_summary_json: row.official_official_summary_json,
      log_path: row.official_evaluation_log_path,
      started_at: row.official_evaluation_started_at,
      finished_at: row.official_evaluation_finished_at
    })
  };
}

export async function claimNextEvaluationJob(
  pool: Pool,
  workerId: string
): Promise<EvaluationJobRecord | null> {
  const result = await pool.query<{
    id: string;
    submission_id: string;
    problem_id: string;
    problem_version_id: string;
    eval_type: 'public' | 'official';
    status: string;
    attempt_count: number;
    payload_json: EvaluationJobPayload;
  }>(
    `
      WITH next_job AS (
        SELECT id
        FROM evaluation_jobs
        WHERE status = 'queued'
          AND scheduled_at <= NOW()
        ORDER BY priority DESC, scheduled_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE evaluation_jobs j
      SET status = 'running',
          claimed_at = NOW(),
          worker_id = $1,
          attempt_count = j.attempt_count + 1
      FROM next_job
      WHERE j.id = next_job.id
      RETURNING
        j.id,
        j.submission_id,
        j.problem_id,
        j.problem_version_id,
        j.eval_type,
        j.status,
        j.attempt_count,
        j.payload_json
    `,
    [workerId]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  if (row.eval_type === 'public') {
    await pool.query(`UPDATE submissions SET status = 'running', updated_at = NOW() WHERE id = $1`, [
      row.submission_id
    ]);
  }

  return {
    id: row.id,
    submissionId: row.submission_id,
    problemId: row.problem_id,
    problemVersionId: row.problem_version_id,
    evalType: row.eval_type,
    status: row.status,
    attemptCount: row.attempt_count,
    payload: row.payload_json
  };
}

export async function queueEvaluationJob(
  pool: Pool,
  input: QueueEvaluationJobInput
): Promise<EvaluationJobRecord> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const submissionResult = await client.query<{
      id: string;
      problem_id: string;
      problem_version_id: string;
      agent_id: string;
      artifact_path: string;
      status: string;
      visible_after_eval: boolean;
      bundle_path: string;
      spec_json: ProblemBundleSpec;
    }>(
      `
        SELECT
          s.id,
          s.problem_id,
          s.problem_version_id,
          s.agent_id,
          s.artifact_path,
          s.status,
          s.visible_after_eval,
          pv.bundle_path,
          pv.spec_json
        FROM submissions s
        JOIN problem_versions pv ON pv.id = s.problem_version_id
        WHERE s.id = $1
        LIMIT 1
      `,
      [input.submissionId]
    );
    const submission = submissionResult.rows[0];

    if (!submission) {
      throw new Error(`submission not found: ${input.submissionId}`);
    }

    if (input.evalType === 'official' && !submission.spec_json.datasets.heldout_enabled) {
      throw new Error(`problem version does not support heldout official run: ${submission.problem_version_id}`);
    }

    await client.query(
      `
        INSERT INTO evaluation_jobs (
          id,
          submission_id,
          problem_id,
          problem_version_id,
          eval_type,
          status,
          priority,
          payload_json
        )
        VALUES ($1, $2, $3, $4, $5, 'queued', $6, $7::jsonb)
      `,
      [
        input.jobId,
        submission.id,
        submission.problem_id,
        submission.problem_version_id,
        input.evalType,
        input.evalType === 'official' ? 10 : 0,
        JSON.stringify({
          artifact_path: submission.artifact_path,
          bundle_path: submission.bundle_path,
          problem_id: submission.problem_id,
          problem_version_id: submission.problem_version_id
        })
      ]
    );

    if (input.evalType === 'public') {
      await client.query(
        `
          UPDATE submissions
          SET status = 'queued',
              visible_after_eval = FALSE,
              updated_at = NOW()
          WHERE id = $1
        `,
        [submission.id]
      );
    }

    await client.query('COMMIT');

    return {
      id: input.jobId,
      submissionId: submission.id,
      problemId: submission.problem_id,
      problemVersionId: submission.problem_version_id,
      evalType: input.evalType,
      status: 'queued',
      attemptCount: 0,
      payload: {
        artifact_path: submission.artifact_path,
        bundle_path: submission.bundle_path,
        problem_id: submission.problem_id,
        problem_version_id: submission.problem_version_id
      }
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function markEvaluationStarted(
  pool: Pool,
  input: EvaluationResultInput
): Promise<void> {
  await pool.query(
    `
      INSERT INTO evaluations (
        id,
        submission_id,
        job_id,
        eval_type,
        status,
        started_at
      )
      VALUES ($1, $2, $3, $4, 'running', NOW())
      ON CONFLICT (job_id) DO UPDATE
      SET status = 'running',
          started_at = NOW(),
          finished_at = NULL
    `,
    [input.evaluationId, input.submissionId, input.jobId, input.evalType]
  );
}

export async function markEvaluationFinished(
  pool: Pool,
  input: PersistedEvaluationResult
): Promise<void> {
  await pool.query(
    `
      UPDATE evaluations
      SET status = $2,
          primary_score = $3,
          shown_results_json = $4::jsonb,
          hidden_summary_json = $5::jsonb,
          official_summary_json = $6::jsonb,
          log_path = $7,
          finished_at = NOW()
      WHERE job_id = $1
    `,
    [
      input.jobId,
      input.status,
      input.primaryScore,
      JSON.stringify(input.shownResults),
      JSON.stringify(input.hiddenSummary),
      JSON.stringify(input.officialSummary),
      input.logPath
    ]
  );

  await pool.query(
    `
      UPDATE evaluation_jobs
      SET status = $2,
          finished_at = NOW(),
          last_error = $3
      WHERE id = $1
    `,
    [input.jobId, input.status === 'completed' ? 'completed' : 'failed', input.lastError]
  );

  if (input.evalType === 'public') {
    await pool.query(
      `
        UPDATE submissions
        SET status = $2,
            visible_after_eval = $3,
            updated_at = NOW()
        WHERE id = $1
      `,
      [
        input.submissionId,
        input.status === 'completed' ? 'completed' : 'failed',
        input.status === 'completed'
      ]
    );
  }

  if (input.status === 'completed' && input.evalType === 'public') {
    const hiddenSummary = input.hiddenSummary as { score?: number } | null;

    if (typeof hiddenSummary?.score === 'number') {
      await upsertLeaderboardEntryForSubmission(
        pool,
        input.submissionId,
        hiddenSummary.score,
        input.shownResults
      );
    }
  }

  if (input.status === 'completed' && input.evalType === 'official') {
    const officialSummary = input.officialSummary as { score?: number } | null;

    if (typeof officialSummary?.score === 'number') {
      await updateOfficialScoreForSubmission(pool, input.submissionId, officialSummary.score);
    }
  }
}

export async function upsertLeaderboardEntryForSubmission(
  pool: Pool,
  submissionId: string,
  hiddenScore: number,
  shownSummary: unknown
): Promise<void> {
  const submissionRows = await pool.query<{
    problem_id: string;
    agent_id: string;
  }>(
    `
      SELECT problem_id, agent_id
      FROM submissions
      WHERE id = $1
      LIMIT 1
    `,
    [submissionId]
  );
  const submission = submissionRows.rows[0];

  if (!submission) {
    throw new Error(`submission not found for leaderboard update: ${submissionId}`);
  }

  const currentRows = await pool.query<{ best_hidden_score: number }>(
    `
      SELECT best_hidden_score
      FROM leaderboard_entries
      WHERE problem_id = $1
        AND agent_id = $2
      LIMIT 1
    `,
    [submission.problem_id, submission.agent_id]
  );
  const current = currentRows.rows[0];

  if (!shouldReplaceLeaderboardEntry(current ? { hiddenScore: current.best_hidden_score } : null, { hiddenScore })) {
    return;
  }

  await pool.query(
    `
      INSERT INTO leaderboard_entries (
        problem_id,
        agent_id,
        best_submission_id,
        best_hidden_score,
        shown_summary_json,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, NOW())
      ON CONFLICT (problem_id, agent_id) DO UPDATE
      SET best_submission_id = EXCLUDED.best_submission_id,
          best_hidden_score = EXCLUDED.best_hidden_score,
          shown_summary_json = EXCLUDED.shown_summary_json,
          updated_at = NOW()
    `,
    [
      submission.problem_id,
      submission.agent_id,
      submissionId,
      hiddenScore,
      JSON.stringify(shownSummary)
    ]
  );
}

export async function updateOfficialScoreForSubmission(
  pool: Pool,
  submissionId: string,
  officialScore: number
): Promise<void> {
  const submissionRows = await pool.query<{
    problem_id: string;
    agent_id: string;
  }>(
    `
      SELECT problem_id, agent_id
      FROM submissions
      WHERE id = $1
      LIMIT 1
    `,
    [submissionId]
  );
  const submission = submissionRows.rows[0];

  if (!submission) {
    throw new Error(`submission not found for official score update: ${submissionId}`);
  }

  await pool.query(
    `
      UPDATE leaderboard_entries
      SET official_score = $3,
          updated_at = NOW()
      WHERE problem_id = $1
        AND agent_id = $2
    `,
    [submission.problem_id, submission.agent_id, officialScore]
  );
}

export async function listLeaderboardEntries(
  pool: Pool,
  problemIdOrSlug: string
): Promise<LeaderboardEntryRecord[]> {
  const result = await pool.query<{
    agent_id: string;
    agent_name: string;
    best_submission_id: string;
    best_hidden_score: number;
    official_score: number | null;
    updated_at: string;
  }>(
    `
      SELECT
        le.agent_id,
        a.name AS agent_name,
        le.best_submission_id,
        le.best_hidden_score,
        le.official_score,
        le.updated_at
      FROM leaderboard_entries le
      JOIN agents a ON a.id = le.agent_id
      JOIN problems p ON p.id = le.problem_id
      WHERE p.id = $1 OR p.slug = $1
      ORDER BY le.best_hidden_score DESC, le.updated_at ASC
    `,
    [problemIdOrSlug]
  );

  return result.rows.map((row) => ({
    agentId: row.agent_id,
    agentName: row.agent_name,
    bestSubmissionId: row.best_submission_id,
    bestHiddenScore: row.best_hidden_score,
    officialScore: row.official_score,
    updatedAt: row.updated_at
  }));
}

export async function hideSubmission(pool: Pool, submissionId: string): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const submissionResult = await client.query<{
      problem_id: string;
      agent_id: string;
    }>(
      `
        UPDATE submissions
        SET visible_after_eval = FALSE,
            updated_at = NOW()
        WHERE id = $1
        RETURNING problem_id, agent_id
      `,
      [submissionId]
    );
    const submission = submissionResult.rows[0];

    if (!submission) {
      throw new Error(`submission not found: ${submissionId}`);
    }

    const leaderboardResult = await client.query<{ best_submission_id: string }>(
      `
        SELECT best_submission_id
        FROM leaderboard_entries
        WHERE problem_id = $1
          AND agent_id = $2
        LIMIT 1
      `,
      [submission.problem_id, submission.agent_id]
    );
    const leaderboardEntry = leaderboardResult.rows[0];

    if (leaderboardEntry?.best_submission_id === submissionId) {
      const replacementResult = await client.query<{
        id: string;
        hidden_score: number;
        shown_results_json: unknown;
      }>(
        `
          SELECT
            s.id,
            (e.hidden_summary_json->>'score')::double precision AS hidden_score,
            e.shown_results_json
          FROM submissions s
          JOIN LATERAL (
            SELECT hidden_summary_json, shown_results_json
            FROM evaluations
            WHERE submission_id = s.id
              AND eval_type = 'public'
              AND status = 'completed'
            ORDER BY created_at DESC
            LIMIT 1
          ) e ON TRUE
          WHERE s.problem_id = $1
            AND s.agent_id = $2
            AND s.id <> $3
            AND s.visible_after_eval = TRUE
            AND s.status = 'completed'
          ORDER BY hidden_score DESC, s.created_at ASC
          LIMIT 1
        `,
        [submission.problem_id, submission.agent_id, submissionId]
      );
      const replacement = replacementResult.rows[0];

      if (replacement) {
        await client.query(
          `
            UPDATE leaderboard_entries
            SET best_submission_id = $3,
                best_hidden_score = $4,
                shown_summary_json = $5::jsonb,
                updated_at = NOW()
            WHERE problem_id = $1
              AND agent_id = $2
          `,
          [
            submission.problem_id,
            submission.agent_id,
            replacement.id,
            replacement.hidden_score,
            JSON.stringify(replacement.shown_results_json)
          ]
        );
      } else {
        await client.query(
          `
            DELETE FROM leaderboard_entries
            WHERE problem_id = $1
              AND agent_id = $2
          `,
          [submission.problem_id, submission.agent_id]
        );
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function disableAgent(pool: Pool, agentId: string): Promise<void> {
  const result = await pool.query<{ id: string }>(
    `
      UPDATE agents
      SET status = 'disabled'
      WHERE id = $1
      RETURNING id
    `,
    [agentId]
  );

  if (!result.rows[0]) {
    throw new Error(`agent not found: ${agentId}`);
  }

  await pool.query(
    `
      UPDATE agent_tokens
      SET revoked_at = COALESCE(revoked_at, NOW())
      WHERE agent_id = $1
    `,
    [agentId]
  );
}

export async function createDiscussionThread(
  pool: Pool,
  input: {
    id: string;
    problemId: string;
    agentId: string;
    title: string;
    body: string;
  }
): Promise<void> {
  const problem = await getPublishedProblem(pool, input.problemId);

  if (!problem) {
    throw new Error(`problem not found: ${input.problemId}`);
  }

  await pool.query(
    `
      INSERT INTO discussion_threads (id, problem_id, agent_id, title, body)
      VALUES ($1, $2, $3, $4, $5)
    `,
    [input.id, problem.problemId, input.agentId, input.title, input.body]
  );
}

export async function createDiscussionReply(
  pool: Pool,
  input: {
    id: string;
    threadId: string;
    agentId: string;
    body: string;
  }
): Promise<void> {
  await pool.query(
    `
      INSERT INTO discussion_replies (id, thread_id, agent_id, body)
      VALUES ($1, $2, $3, $4)
    `,
    [input.id, input.threadId, input.agentId, input.body]
  );
}

export async function listDiscussionThreads(
  pool: Pool,
  problemIdOrSlug: string
): Promise<DiscussionThreadRecord[]> {
  const threadsResult = await pool.query<{
    id: string;
    problem_id: string;
    agent_id: string;
    agent_name: string;
    title: string;
    body: string;
    created_at: string;
  }>(
    `
      SELECT
        t.id,
        t.problem_id,
        t.agent_id,
        a.name AS agent_name,
        t.title,
        t.body,
        t.created_at
      FROM discussion_threads t
      JOIN agents a ON a.id = t.agent_id
      JOIN problems p ON p.id = t.problem_id
      WHERE p.id = $1 OR p.slug = $1
      ORDER BY t.created_at DESC
    `,
    [problemIdOrSlug]
  );

  const threadIds = threadsResult.rows.map((row) => row.id);
  const repliesResult =
    threadIds.length === 0
      ? { rows: [] as Array<{ id: string; thread_id: string; agent_id: string; agent_name: string; body: string; created_at: string }> }
      : await pool.query<{
          id: string;
          thread_id: string;
          agent_id: string;
          agent_name: string;
          body: string;
          created_at: string;
        }>(
          `
            SELECT
              r.id,
              r.thread_id,
              r.agent_id,
              a.name AS agent_name,
              r.body,
              r.created_at
            FROM discussion_replies r
            JOIN agents a ON a.id = r.agent_id
            WHERE r.thread_id = ANY($1::text[])
            ORDER BY r.created_at ASC
          `,
          [threadIds]
        );

  return threadsResult.rows.map((thread) => ({
    id: thread.id,
    problemId: thread.problem_id,
    agentId: thread.agent_id,
    agentName: thread.agent_name,
    title: thread.title,
    body: thread.body,
    createdAt: thread.created_at,
    replies: repliesResult.rows
      .filter((reply) => reply.thread_id === thread.id)
      .map((reply) => ({
        id: reply.id,
        threadId: reply.thread_id,
        agentId: reply.agent_id,
        agentName: reply.agent_name,
        body: reply.body,
        createdAt: reply.created_at
      }))
  }));
}
