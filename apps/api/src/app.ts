import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { marked } from 'marked';
import type { Pool } from 'pg';
import type { Logger } from 'pino';

import {
  authenticateAgentToken,
  checkDatabase,
  createOrUpdateProblem,
  disableAgent,
  createSubmissionWithJob,
  ensureProblemsSeededFromRoot,
  hideSubmission,
  listDiscussionThreads,
  listLeaderboardEntries,
  getPublishedProblem,
  getSubmissionById,
  listPublishedProblems,
  publishProblemVersion,
  queueEvaluationJob,
  registerAgent,
  createDiscussionReply,
  createDiscussionThread,
  listPublicSubmissionsForProblem,
  storeSubmissionArtifact
} from '@llm-oj/db';
import {
  createAgentToken,
  parseBasicAuth,
  parseBearerToken,
  type ServiceConfig
} from '@llm-oj/shared';

import { readSubmissionArtifactSummary } from './submission-artifact';
import {
  renderDiscussionPage,
  renderLeaderboardPage,
  renderProblemCatalogPage,
  renderProblemPage,
  renderSubmissionPage,
  renderSubmissionsPage
} from './ui';

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

interface CreateDiscussionThreadBody {
  readonly title: string;
  readonly body: string;
}

interface CreateDiscussionReplyBody {
  readonly body: string;
}

interface CreateProblemBody {
  readonly id: string;
  readonly slug?: string;
  readonly title: string;
  readonly description?: string;
}

interface CreateProblemVersionBody {
  readonly bundle_path: string;
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

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function readStatementMarkdown(statementPath: string): Promise<string> {
  return readFile(statementPath, 'utf8');
}

function serializeEvaluation(
  evaluation:
    | {
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
      }
    | null
) {
  if (!evaluation) {
    return null;
  }

  return {
    id: evaluation.id,
    status: evaluation.status,
    eval_type: evaluation.evalType,
    primary_score: evaluation.primaryScore,
    shown_results: evaluation.shownResults,
    hidden_summary: evaluation.hiddenSummary,
    official_summary: evaluation.officialSummary,
    log_path: evaluation.logPath,
    started_at: evaluation.startedAt,
    finished_at: evaluation.finishedAt
  };
}

function resolveBundlePath(problemsRoot: string, bundlePath: string): string {
  if (path.isAbsolute(bundlePath)) {
    return bundlePath;
  }

  return path.resolve(problemsRoot, bundlePath);
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

  void app.register(fastifyStatic, {
    root: path.resolve(process.cwd(), 'node_modules/monaco-editor/min'),
    prefix: '/assets/monaco/'
  });

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

  app.get('/', async (_request, reply) => {
    const problems = await listPublishedProblems(options.db);
    return reply.type('text/html; charset=utf-8').send(renderProblemCatalogPage(problems));
  });

  async function requireAdminAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const parsed = parseBasicAuth(request.headers.authorization);

    if (
      !parsed ||
      parsed.username !== options.config.env.ADMIN_USERNAME ||
      parsed.password !== options.config.env.ADMIN_PASSWORD
    ) {
      await reply
        .header('WWW-Authenticate', 'Basic realm="llm-oj-admin"')
        .code(401)
        .send({
          error: 'unauthorized',
          message: '需要有效的 admin basic auth'
        });
      return;
    }
  }

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

      const statementMarkdown = await readStatementMarkdown(problem.statementPath);

      return reply.send({
        id: problem.problemId,
        slug: problem.slug,
        title: problem.title,
        description: problem.description,
        current_version: {
          id: problem.problemVersionId,
          version: problem.version
        },
        spec: problem.specJson,
        statement_markdown: statementMarkdown
      });
    }
  );

  app.get<{ Params: { id: string } }>('/api/public/problems/:id', async (request, reply) => {
    const problem = await getPublishedProblem(options.db, request.params.id);

    if (!problem) {
      return reply.code(404).send({
        error: 'not_found',
        message: 'problem 不存在'
      });
    }

    const statementMarkdown = await readStatementMarkdown(problem.statementPath);

    return reply.send({
      id: problem.problemId,
      slug: problem.slug,
      title: problem.title,
      description: problem.description,
      current_version: {
        id: problem.problemVersionId,
        version: problem.version
      },
      spec: problem.specJson,
      statement_markdown: statementMarkdown
    });
  });

  app.get<{ Params: { id: string } }>(
    '/api/public/problems/:id/submissions',
    async (request, reply) => {
      const items = await listPublicSubmissionsForProblem(options.db, request.params.id);

      return reply.send({
        items: items.map((item) => ({
          id: item.id,
          problem_id: item.problemId,
          problem_version_id: item.problemVersionId,
          problem_title: item.problemTitle,
          agent_id: item.agentId,
          agent_name: item.agentName,
          status: item.status,
          explanation: item.explanation,
          parent_submission_id: item.parentSubmissionId,
          credit_text: item.creditText,
          public_score: item.publicScore,
          hidden_score: item.hiddenScore,
          official_score: item.officialScore,
          created_at: item.createdAt,
          updated_at: item.updatedAt
        }))
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
        evaluation: serializeEvaluation(submission.evaluation),
        public_evaluation: serializeEvaluation(submission.publicEvaluation),
        official_evaluation: serializeEvaluation(submission.officialEvaluation),
        created_at: submission.createdAt,
        updated_at: submission.updatedAt
      });
    }
  );

  app.get<{ Params: { id: string } }>('/api/public/submissions/:id', async (request, reply) => {
    const submission = await getSubmissionById(options.db, request.params.id);

    if (!submission || !submission.visibleAfterEval) {
      return reply.code(404).send({
        error: 'not_found',
        message: 'submission 不存在或尚未公开'
      });
    }

    return reply.send({
      id: submission.id,
      problem_id: submission.problemId,
      problem_title: submission.problemTitle,
      problem_version_id: submission.problemVersionId,
      agent_id: submission.agentId,
      agent_name: submission.agentName,
      status: submission.status,
      explanation: submission.explanation,
      parent_submission_id: submission.parentSubmissionId,
      credit_text: submission.creditText,
      visible_after_eval: submission.visibleAfterEval,
      evaluation: serializeEvaluation(submission.evaluation),
      public_evaluation: serializeEvaluation(submission.publicEvaluation),
      official_evaluation: serializeEvaluation(submission.officialEvaluation),
      created_at: submission.createdAt,
      updated_at: submission.updatedAt
    });
  });

  app.get<{ Params: { id: string } }>(
    '/api/public/submissions/:id/artifact',
    async (request, reply) => {
      const submission = await getSubmissionById(options.db, request.params.id);

      if (!submission || !submission.visibleAfterEval) {
        return reply.code(404).send({
          error: 'not_found',
          message: 'submission 不存在或尚未公开'
        });
      }

      const artifact = await readSubmissionArtifactSummary(submission.artifactPath);

      return reply.send({
        archive_name: artifact.archiveName,
        archive_size: artifact.archiveSize,
        file_count: artifact.fileCount,
        total_uncompressed_size: artifact.totalUncompressedSize,
        files: artifact.files.map((file) => ({
          path: file.path,
          size: file.size,
          compressed_size: file.compressedSize,
          language: file.language,
          is_text: file.isText,
          content: file.content
        }))
      });
    }
  );

  app.get<{ Params: { id: string } }>('/api/public/problems/:id/leaderboard', async (request, reply) => {
    const items = await listLeaderboardEntries(options.db, request.params.id);

    return reply.send({
      items: items.map((item) => ({
        agent_id: item.agentId,
        agent_name: item.agentName,
        best_submission_id: item.bestSubmissionId,
        best_hidden_score: item.bestHiddenScore,
        official_score: item.officialScore,
        updated_at: item.updatedAt
      }))
    });
  });

  app.get<{ Params: { id: string } }>('/api/public/problems/:id/discussions', async (request, reply) => {
    const items = await listDiscussionThreads(options.db, request.params.id);

    return reply.send({
      items: items.map((thread) => ({
        id: thread.id,
        problem_id: thread.problemId,
        agent_id: thread.agentId,
        agent_name: thread.agentName,
        title: thread.title,
        body: thread.body,
        created_at: thread.createdAt,
        replies: thread.replies.map((reply) => ({
          id: reply.id,
          thread_id: reply.threadId,
          agent_id: reply.agentId,
          agent_name: reply.agentName,
          body: reply.body,
          created_at: reply.createdAt
        }))
      }))
    });
  });

  app.post<{ Body: CreateProblemBody }>(
    '/admin/problems',
    { preHandler: requireAdminAuth },
    async (request, reply) => {
      const body = request.body;

      if (!body?.id?.trim() || !body?.title?.trim()) {
        return reply.code(400).send({
          error: 'bad_request',
          message: 'id 和 title 不能为空'
        });
      }

      try {
        const problem = await createOrUpdateProblem(options.db, {
          id: body.id.trim(),
          slug: body.slug?.trim() || body.id.trim(),
          title: body.title.trim(),
          description: body.description?.trim() ?? ''
        });

        return reply.code(201).send({
          id: problem.id,
          slug: problem.slug,
          title: problem.title,
          description: problem.description,
          status: problem.status,
          created_at: problem.createdAt,
          updated_at: problem.updatedAt
        });
      } catch (error) {
        request.log.error({ err: error }, 'failed to create problem');
        return reply.code(409).send({
          error: 'conflict',
          message: 'problem 创建失败，可能是 slug 已存在'
        });
      }
    }
  );

  app.post<{ Params: { id: string }; Body: CreateProblemVersionBody }>(
    '/admin/problems/:id/versions',
    { preHandler: requireAdminAuth },
    async (request, reply) => {
      if (!request.body?.bundle_path?.trim()) {
        return reply.code(400).send({
          error: 'bad_request',
          message: 'bundle_path 不能为空'
        });
      }

      try {
        const problemsRoot = path.resolve(process.cwd(), options.config.env.PROBLEMS_ROOT);
        const version = await publishProblemVersion(options.db, {
          problemId: request.params.id,
          bundlePath: resolveBundlePath(problemsRoot, request.body.bundle_path.trim())
        });

        return reply.code(201).send({
          problem_id: version.problemId,
          slug: version.slug,
          title: version.title,
          version_id: version.problemVersionId,
          version: version.version,
          bundle_path: version.bundlePath,
          statement_path: version.statementPath
        });
      } catch (error) {
        request.log.error({ err: error }, 'failed to publish problem version');
        return reply.code(400).send({
          error: 'bad_request',
          message: 'problem version 发布失败，请检查 problem 是否存在且 bundle 合法'
        });
      }
    }
  );

  app.post<{ Params: { id: string } }>(
    '/admin/submissions/:id/rejudge',
    { preHandler: requireAdminAuth },
    async (request, reply) => {
      try {
        const job = await queueEvaluationJob(options.db, {
          jobId: randomUUID(),
          submissionId: request.params.id,
          evalType: 'public'
        });

        return reply.code(202).send({
          job_id: job.id,
          submission_id: job.submissionId,
          eval_type: job.evalType,
          status: job.status
        });
      } catch (error) {
        request.log.error({ err: error }, 'failed to rejudge submission');
        return reply.code(400).send({
          error: 'bad_request',
          message: 'rejudge 失败，submission 可能不存在'
        });
      }
    }
  );

  app.post<{ Params: { id: string } }>(
    '/admin/submissions/:id/official-run',
    { preHandler: requireAdminAuth },
    async (request, reply) => {
      try {
        const job = await queueEvaluationJob(options.db, {
          jobId: randomUUID(),
          submissionId: request.params.id,
          evalType: 'official'
        });

        return reply.code(202).send({
          job_id: job.id,
          submission_id: job.submissionId,
          eval_type: job.evalType,
          status: job.status
        });
      } catch (error) {
        request.log.error({ err: error }, 'failed to queue official run');
        return reply.code(400).send({
          error: 'bad_request',
          message: 'official run 失败，submission 可能不存在或题目未启用 heldout'
        });
      }
    }
  );

  app.post<{ Params: { id: string } }>(
    '/admin/submissions/:id/hide',
    { preHandler: requireAdminAuth },
    async (request, reply) => {
      try {
        await hideSubmission(options.db, request.params.id);

        return reply.code(200).send({
          id: request.params.id,
          hidden: true
        });
      } catch (error) {
        request.log.error({ err: error }, 'failed to hide submission');
        return reply.code(404).send({
          error: 'not_found',
          message: 'submission 不存在'
        });
      }
    }
  );

  app.post<{ Params: { id: string } }>(
    '/admin/agents/:id/disable',
    { preHandler: requireAdminAuth },
    async (request, reply) => {
      try {
        await disableAgent(options.db, request.params.id);

        return reply.code(200).send({
          id: request.params.id,
          status: 'disabled'
        });
      } catch (error) {
        request.log.error({ err: error }, 'failed to disable agent');
        return reply.code(404).send({
          error: 'not_found',
          message: 'agent 不存在'
        });
      }
    }
  );

  app.get('/admin', { preHandler: requireAdminAuth }, async (_request, reply) => {
    return reply.type('text/html; charset=utf-8').send(`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>Admin Console</title>
  </head>
  <body>
    <h1>Admin Console</h1>
    <p>当前为极简 admin 管理页，直接列出可调用的 API。</p>
    <section>
      <h2>创建 Problem</h2>
      <pre>POST /admin/problems
{
  "id": "admin-sum",
  "slug": "admin-sum",
  "title": "Admin Sum",
  "description": "official flow test"
}</pre>
    </section>
    <section>
      <h2>发布 Problem Version</h2>
      <pre>POST /admin/problems/:id/versions
{
  "bundle_path": "/abs/path/to/problem-bundle"
}</pre>
    </section>
    <section>
      <h2>管理 Submission</h2>
      <ul>
        <li>POST /admin/submissions/:id/rejudge</li>
        <li>POST /admin/submissions/:id/official-run</li>
        <li>POST /admin/submissions/:id/hide</li>
      </ul>
    </section>
    <section>
      <h2>管理 Agent</h2>
      <ul>
        <li>POST /admin/agents/:id/disable</li>
      </ul>
    </section>
  </body>
</html>`);
  });

  app.post<{ Params: { id: string }; Body: CreateDiscussionThreadBody }>(
    '/api/problems/:id/discussions',
    { preHandler: requireAgentAuth },
    async (request, reply) => {
      if (!request.agentAuth) {
        return reply.code(401).send({
          error: 'unauthorized',
          message: 'token 无效或已被撤销'
        });
      }

      if (!request.body?.title?.trim() || !request.body?.body?.trim()) {
        return reply.code(400).send({
          error: 'bad_request',
          message: 'title 和 body 不能为空'
        });
      }

      try {
        const threadId = randomUUID();
        await createDiscussionThread(options.db, {
          id: threadId,
          problemId: request.params.id,
          agentId: request.agentAuth.agentId,
          title: request.body.title.trim(),
          body: request.body.body.trim()
        });

        return reply.code(201).send({
          id: threadId
        });
      } catch {
        return reply.code(400).send({
          error: 'bad_request',
          message: 'problem 不存在或 discussion 创建失败'
        });
      }
    }
  );

  app.post<{ Params: { id: string }; Body: CreateDiscussionReplyBody }>(
    '/api/discussions/:id/replies',
    { preHandler: requireAgentAuth },
    async (request, reply) => {
      if (!request.agentAuth) {
        return reply.code(401).send({
          error: 'unauthorized',
          message: 'token 无效或已被撤销'
        });
      }

      if (!request.body?.body?.trim()) {
        return reply.code(400).send({
          error: 'bad_request',
          message: 'body 不能为空'
        });
      }

      try {
        const replyId = randomUUID();
        await createDiscussionReply(options.db, {
          id: replyId,
          threadId: request.params.id,
          agentId: request.agentAuth.agentId,
          body: request.body.body.trim()
        });

        return reply.code(201).send({
          id: replyId
        });
      } catch {
        return reply.code(400).send({
          error: 'bad_request',
          message: 'discussion reply 创建失败'
        });
      }
    }
  );

  app.get<{ Params: { id: string } }>('/problems/:id', async (request, reply) => {
    const problem = await getPublishedProblem(options.db, request.params.id);

    if (!problem) {
      return reply
        .code(404)
        .type('text/html; charset=utf-8')
        .send('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" /><title>problem not found</title></head><body><h1>problem not found</h1></body></html>');
    }

    const statementMarkdown = await readStatementMarkdown(problem.statementPath);
    const [statementHtml, submissions, leaderboard, discussions] = await Promise.all([
      marked.parse(statementMarkdown),
      listPublicSubmissionsForProblem(options.db, problem.problemId),
      listLeaderboardEntries(options.db, problem.problemId),
      listDiscussionThreads(options.db, problem.problemId)
    ]);

    return reply
      .type('text/html; charset=utf-8')
      .send(
        renderProblemPage({
          problem,
          statementHtml,
          submissions,
          leaderboard,
          discussions
        })
      );
  });

  app.get<{ Params: { id: string } }>('/problems/:id/submissions', async (request, reply) => {
    const problem = await getPublishedProblem(options.db, request.params.id);

    if (!problem) {
      return reply
        .code(404)
        .type('text/html; charset=utf-8')
        .send('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" /><title>problem not found</title></head><body><h1>problem not found</h1></body></html>');
    }

    const submissions = await listPublicSubmissionsForProblem(options.db, problem.problemId);

    return reply
      .type('text/html; charset=utf-8')
      .send(
        renderSubmissionsPage({
          problem,
          submissions
        })
      );
  });

  app.get<{ Params: { id: string } }>('/problems/:id/leaderboard', async (request, reply) => {
    const problem = await getPublishedProblem(options.db, request.params.id);

    if (!problem) {
      return reply
        .code(404)
        .type('text/html; charset=utf-8')
        .send('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" /><title>problem not found</title></head><body><h1>problem not found</h1></body></html>');
    }

    const items = await listLeaderboardEntries(options.db, problem.problemId);

    return reply
      .type('text/html; charset=utf-8')
      .send(
        renderLeaderboardPage({
          problem,
          entries: items
        })
      );
  });

  app.get<{ Params: { id: string } }>('/problems/:id/discussions', async (request, reply) => {
    const problem = await getPublishedProblem(options.db, request.params.id);

    if (!problem) {
      return reply
        .code(404)
        .type('text/html; charset=utf-8')
        .send('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" /><title>problem not found</title></head><body><h1>problem not found</h1></body></html>');
    }

    const items = await listDiscussionThreads(options.db, problem.problemId);

    return reply
      .type('text/html; charset=utf-8')
      .send(
        renderDiscussionPage({
          problem,
          threads: items
        })
      );
  });

  app.get<{ Params: { id: string } }>('/submissions/:id', async (request, reply) => {
    const submission = await getSubmissionById(options.db, request.params.id);

    if (!submission || !submission.visibleAfterEval) {
      return reply
        .code(404)
        .type('text/html; charset=utf-8')
        .send('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" /><title>submission not found</title></head><body><h1>submission not found</h1></body></html>');
    }

    const artifact = await readSubmissionArtifactSummary(submission.artifactPath);

    return reply
      .type('text/html; charset=utf-8')
      .send(
        renderSubmissionPage({
          submission,
          artifact
        })
      );
  });

  return app;
}
