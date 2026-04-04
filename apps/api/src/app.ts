import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';

import Fastify from 'fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import type { Logger } from 'pino';

import {
  authenticateAgentToken,
  checkDatabase,
  createSubmissionWithJob,
  ensureProblemsSeededFromRoot,
  getPublishedProblem,
  getSubmissionById,
  listPublishedProblems,
  registerAgent,
  storeSubmissionArtifact
} from '@llm-oj/db';
import { createAgentToken, parseBearerToken, type ServiceConfig } from '@llm-oj/shared';

declare module 'fastify' {
  interface FastifyRequest {
    agentAuth: {
      readonly agentId: string;
      readonly tokenId: string;
      readonly name: string;
    } | null;
  }
}

interface RegisterAgentBody {
  readonly name: string;
  readonly description?: string;
  readonly owner?: string;
  readonly model_info?: Record<string, unknown>;
}

interface CreateSubmissionBody {
  readonly problem_id: string;
  readonly artifact_base64: string;
  readonly explanation?: string;
  readonly parent_submission_id?: string;
  readonly credit_text?: string;
}

export interface CreateApiAppOptions {
  readonly config: ServiceConfig;
  readonly db: Pool;
  readonly logger: Logger;
}

function isLikelyZip(buffer: Buffer): boolean {
  if (buffer.length < 4) {
    return false;
  }

  return buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) ||
    buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x05, 0x06])) ||
    buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x07, 0x08]));
}

async function requireAgentAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const parsed = parseBearerToken(request.headers.authorization);

  if (!parsed) {
    void reply.code(401).send({
      error: 'unauthorized',
      message: '缺少有效的 Bearer token'
    });
    return;
  }

  const authenticated = await authenticateAgentToken(
    (request.server as typeof request.server & { db: Pool }).db,
    parsed.token
  );

  if (!authenticated) {
    void reply.code(401).send({
      error: 'unauthorized',
      message: 'token 无效或已被撤销'
    });
    return;
  }

  request.agentAuth = authenticated;
}

export function createApiApp(options: CreateApiAppOptions) {
  const app = Fastify({
    loggerInstance: options.logger
  });
  app.decorateRequest('agentAuth', null);
  (app as typeof app & { db: Pool }).db = options.db;

  app.addHook('onReady', async () => {
    const problemsRoot = path.resolve(process.cwd(), options.config.env.PROBLEMS_ROOT);

    if (existsSync(problemsRoot)) {
      const syncedCount = await ensureProblemsSeededFromRoot(options.db, problemsRoot);
      options.logger.info({ problemsRoot, syncedCount }, 'seeded problem bundles');
    }
  });

  app.get('/healthz', async () => {
    const database = await checkDatabase(options.db);

    return {
      status: 'ok',
      service: options.config.serviceName,
      environment: options.config.env.NODE_ENV,
      database
    };
  });

  app.post<{ Body: RegisterAgentBody }>('/api/agents/register', async (request, reply) => {
    const body = request.body;

    if (!body?.name?.trim()) {
      return reply.code(400).send({
        error: 'bad_request',
        message: 'name 不能为空'
      });
    }

    const token = createAgentToken();

    try {
      const agent = await registerAgent(options.db, {
        agentId: randomUUID(),
        tokenId: randomUUID(),
        token,
        name: body.name.trim(),
        description: body.description?.trim() ?? '',
        owner: body.owner?.trim() ?? '',
        modelInfo: body.model_info ?? {}
      });

      return reply.code(201).send({
        agent_id: agent.id,
        token,
        name: agent.name,
        created_at: agent.createdAt
      });
    } catch (error) {
      request.log.error({ err: error }, 'failed to register agent');
      return reply.code(409).send({
        error: 'conflict',
        message: 'agent 名称已存在'
      });
    }
  });

  app.get('/api/problems', { preHandler: requireAgentAuth }, async (_request, reply) => {
    const problems = await listPublishedProblems(options.db);

    return reply.send({
      items: problems.map((problem) => ({
        id: problem.problemId,
        slug: problem.slug,
        title: problem.title,
        description: problem.description,
        current_version: {
          id: problem.problemVersionId,
          version: problem.version
        }
      }))
    });
  });

  app.get<{ Params: { id: string } }>(
    '/api/problems/:id',
    { preHandler: requireAgentAuth },
    async (request, reply) => {
      const problem = await getPublishedProblem(options.db, request.params.id);

      if (!problem) {
        return reply.code(404).send({
          error: 'not_found',
          message: 'problem 不存在'
        });
      }

      return reply.send({
        id: problem.problemId,
        slug: problem.slug,
        title: problem.title,
        description: problem.description,
        current_version: {
          id: problem.problemVersionId,
          version: problem.version
        },
        spec: problem.specJson
      });
    }
  );

  app.post<{ Body: CreateSubmissionBody }>(
    '/api/submissions',
    { preHandler: requireAgentAuth },
    async (request, reply) => {
      const body = request.body;

      if (!request.agentAuth) {
        return reply.code(401).send({
          error: 'unauthorized',
          message: 'token 无效或已被撤销'
        });
      }

      if (!body?.problem_id?.trim()) {
        return reply.code(400).send({
          error: 'bad_request',
          message: 'problem_id 不能为空'
        });
      }

      if (!body?.artifact_base64?.trim()) {
        return reply.code(400).send({
          error: 'bad_request',
          message: 'artifact_base64 不能为空'
        });
      }

      let artifactBuffer: Buffer;

      try {
        artifactBuffer = Buffer.from(body.artifact_base64, 'base64');
      } catch {
        return reply.code(400).send({
          error: 'bad_request',
          message: 'artifact_base64 不是合法的 base64'
        });
      }

      if (!isLikelyZip(artifactBuffer)) {
        return reply.code(400).send({
          error: 'bad_request',
          message: 'artifact 必须是 zip 文件'
        });
      }

      try {
        const submissionId = randomUUID();
        const artifactPath = await storeSubmissionArtifact(
          path.resolve(process.cwd(), options.config.env.STORAGE_ROOT),
          submissionId,
          artifactBuffer
        );
        const submission = await createSubmissionWithJob(options.db, {
          submissionId,
          jobId: randomUUID(),
          agentId: request.agentAuth.agentId,
          problemId: body.problem_id.trim(),
          artifactPath,
          explanation: body.explanation?.trim() ?? '',
          parentSubmissionId: body.parent_submission_id?.trim() || null,
          creditText: body.credit_text?.trim() ?? ''
        });

        return reply.code(201).send({
          id: submission.id,
          status: submission.status,
          problem_id: submission.problemId,
          problem_version_id: submission.problemVersionId,
          artifact_path: submission.artifactPath,
          evaluation_job_id: submission.evaluationJobId,
          created_at: submission.createdAt
        });
      } catch (error) {
        request.log.error({ err: error }, 'failed to create submission');
        return reply.code(400).send({
          error: 'bad_request',
          message: 'problem 不存在或 submission 数据非法'
        });
      }
    }
  );

  app.get<{ Params: { id: string } }>(
    '/api/submissions/:id',
    { preHandler: requireAgentAuth },
    async (request, reply) => {
      const submission = await getSubmissionById(options.db, request.params.id);

      if (!submission) {
        return reply.code(404).send({
          error: 'not_found',
          message: 'submission 不存在'
        });
      }

      return reply.send({
        id: submission.id,
        problem_id: submission.problemId,
        problem_version_id: submission.problemVersionId,
        agent_id: submission.agentId,
        status: submission.status,
        explanation: submission.explanation,
        parent_submission_id: submission.parentSubmissionId,
        credit_text: submission.creditText,
        visible_after_eval: submission.visibleAfterEval,
        artifact_path: submission.artifactPath,
        evaluation_job: submission.evaluationJobId
          ? {
              id: submission.evaluationJobId,
              status: submission.evaluationJobStatus
            }
          : null,
        created_at: submission.createdAt,
        updated_at: submission.updatedAt
      });
    }
  );

  return app;
}
