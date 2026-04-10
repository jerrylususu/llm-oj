import type { IncomingMessage, Server, ServerResponse } from 'node:http';

import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler
} from 'fastify';
import type { Logger } from 'pino';
import type { ServiceConfig } from '@llm-oj/shared';

import {
  createDiscussionReplyRequestSchema,
  createDiscussionThreadRequestSchema,
  createProblemRequestSchema,
  createProblemVersionRequestSchema,
  createSubmissionRequestSchema,
  registerAgentRequestSchema
} from '@llm-oj/contracts';

import { parseRequestBody, requireAuthenticatedAgent } from '../http';
import {
  presentCreateSubmission,
  presentDiscussionList,
  presentId,
  presentLeaderboard,
  presentProblemDetail,
  presentProblemList,
  presentProblemRecord,
  presentProblemVersion,
  presentPublicSubmissionList,
  presentQueuedJob,
  presentRegisterAgent,
  presentSubmission,
  presentSubmissionArtifact
} from '../presenters';
import type { ApiService } from '../services';

type RouteApp = FastifyInstance<
  Server,
  IncomingMessage,
  ServerResponse<IncomingMessage>,
  Logger
>;
type IdParamsRequest = FastifyRequest<{ Params: { id: string } }>;

export interface ApiRouteOptions {
  readonly app: RouteApp;
  readonly service: ApiService;
  readonly config: ServiceConfig;
  readonly requireAgentAuth: preHandlerAsyncHookHandler;
  readonly requireAdminAuth: preHandlerAsyncHookHandler;
}

export function registerApiRoutes(options: ApiRouteOptions): void {
  const { app, service, config, requireAgentAuth, requireAdminAuth } = options;

  app.get('/healthz', async () => {
    const database = await service.health();

    return {
      status: 'ok',
      service: config.serviceName,
      environment: config.env.NODE_ENV,
      database
    };
  });

  app.post('/api/agents/register', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = parseRequestBody(registerAgentRequestSchema, request.body, reply);
    if (!body) {
      return;
    }

    try {
      const { agent, token } = await service.registerAgent(body);
      return reply.code(201).send(presentRegisterAgent(agent, token));
    } catch (error) {
      request.log.error({ err: error }, 'failed to register agent');
      return reply.code(409).send({
        error: 'conflict',
        message: 'agent 名称已存在'
      });
    }
  });

  app.get('/api/problems', { preHandler: requireAgentAuth }, async (_request: FastifyRequest, reply: FastifyReply) => {
    const problems = await service.listProblems();
    return reply.send(presentProblemList(problems));
  });

  app.get<{ Params: { id: string } }>(
    '/api/problems/:id',
    { preHandler: requireAgentAuth },
    async (request: IdParamsRequest, reply: FastifyReply) => {
      const detail = await service.getProblemDetail(request.params.id);

      if (!detail) {
        return reply.code(404).send({
          error: 'not_found',
          message: 'problem 不存在'
        });
      }

      return reply.send(presentProblemDetail(detail.problem, detail.statementMarkdown));
    }
  );

  app.get<{ Params: { id: string } }>('/api/public/problems/:id', async (request: IdParamsRequest, reply: FastifyReply) => {
    const detail = await service.getProblemDetail(request.params.id);

    if (!detail) {
      return reply.code(404).send({
        error: 'not_found',
        message: 'problem 不存在'
      });
    }

    return reply.send(presentProblemDetail(detail.problem, detail.statementMarkdown));
  });

  app.get<{ Params: { id: string } }>(
    '/api/public/problems/:id/submissions',
    async (request: IdParamsRequest, reply: FastifyReply) => {
      const items = await service.listPublicSubmissions(request.params.id);
      return reply.send(presentPublicSubmissionList(items));
    }
  );

  app.post('/api/submissions', { preHandler: requireAgentAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = parseRequestBody(createSubmissionRequestSchema, request.body, reply);
    if (!body) {
      return;
    }

    const agentAuth = requireAuthenticatedAgent(request, reply);
    if (!agentAuth) {
      return;
    }

    try {
      const submission = await service.createSubmission(agentAuth, body);
      return reply.code(201).send(presentCreateSubmission(submission));
    } catch (error) {
      if (error instanceof Error && error.message === 'invalid_base64') {
        return reply.code(400).send({
          error: 'bad_request',
          message: 'artifact_base64 不是合法的 base64'
        });
      }

      if (error instanceof Error && error.message === 'invalid_zip') {
        return reply.code(400).send({
          error: 'bad_request',
          message: 'artifact 必须是 zip 文件'
        });
      }

      request.log.error({ err: error }, 'failed to create submission');
      return reply.code(400).send({
        error: 'bad_request',
        message: 'problem 不存在或 submission 数据非法'
      });
    }
  });

  app.get<{ Params: { id: string } }>(
    '/api/submissions/:id',
    { preHandler: requireAgentAuth },
    async (request: IdParamsRequest, reply: FastifyReply) => {
      const submission = await service.getSubmission(request.params.id);

      if (!submission) {
        return reply.code(404).send({
          error: 'not_found',
          message: 'submission 不存在'
        });
      }

      return reply.send(
        presentSubmission(submission, {
          includeArtifactPath: true,
          includeEvaluationJob: true
        })
      );
    }
  );

  app.get<{ Params: { id: string } }>('/api/public/submissions/:id', async (request: IdParamsRequest, reply: FastifyReply) => {
    const submission = await service.getPublicSubmission(request.params.id);

    if (!submission) {
      return reply.code(404).send({
        error: 'not_found',
        message: 'submission 不存在或尚未公开'
      });
    }

    return reply.send(
      presentSubmission(submission, {
        includeProblemTitle: true,
        includeAgentName: true
      })
    );
  });

  app.get<{ Params: { id: string } }>(
    '/api/public/submissions/:id/artifact',
    async (request: IdParamsRequest, reply: FastifyReply) => {
      const artifactData = await service.getPublicSubmissionArtifact(request.params.id);

      if (!artifactData) {
        return reply.code(404).send({
          error: 'not_found',
          message: 'submission 不存在或尚未公开'
        });
      }

      return reply.send(presentSubmissionArtifact(artifactData.artifact));
    }
  );

  app.get<{ Params: { id: string } }>('/api/public/problems/:id/leaderboard', async (request: IdParamsRequest, reply: FastifyReply) => {
    const items = await service.listLeaderboard(request.params.id);
    return reply.send(presentLeaderboard(items));
  });

  app.get<{ Params: { id: string } }>('/api/public/problems/:id/discussions', async (request: IdParamsRequest, reply: FastifyReply) => {
    const items = await service.listDiscussions(request.params.id);
    return reply.send(presentDiscussionList(items));
  });

  app.post('/admin/problems', { preHandler: requireAdminAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = parseRequestBody(createProblemRequestSchema, request.body, reply);
    if (!body) {
      return;
    }

    try {
      const problem = await service.createProblem(body);
      return reply.code(201).send(presentProblemRecord(problem));
    } catch (error) {
      request.log.error({ err: error }, 'failed to create problem');
      return reply.code(409).send({
        error: 'conflict',
        message: 'problem 创建失败，可能是 slug 已存在'
      });
    }
  });

  app.post<{ Params: { id: string } }>(
    '/admin/problems/:id/versions',
    { preHandler: requireAdminAuth },
    async (request: IdParamsRequest, reply: FastifyReply) => {
      const body = parseRequestBody(createProblemVersionRequestSchema, request.body, reply);
      if (!body) {
        return;
      }

      try {
        const version = await service.publishProblemVersion(request.params.id, body);
        return reply.code(201).send(presentProblemVersion(version));
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
    async (request: IdParamsRequest, reply: FastifyReply) => {
      try {
        const job = await service.queueRejudge(request.params.id);
        return reply.code(202).send(presentQueuedJob(job));
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
    async (request: IdParamsRequest, reply: FastifyReply) => {
      try {
        const job = await service.queueOfficialRun(request.params.id);
        return reply.code(202).send(presentQueuedJob(job));
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
    async (request: IdParamsRequest, reply: FastifyReply) => {
      try {
        await service.hideSubmission(request.params.id);
        return reply.code(200).send({ id: request.params.id, hidden: true });
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
    async (request: IdParamsRequest, reply: FastifyReply) => {
      try {
        await service.disableAgent(request.params.id);
        return reply.code(200).send({ id: request.params.id, status: 'disabled' });
      } catch (error) {
        request.log.error({ err: error }, 'failed to disable agent');
        return reply.code(404).send({
          error: 'not_found',
          message: 'agent 不存在'
        });
      }
    }
  );

  app.post<{ Params: { id: string } }>(
    '/api/problems/:id/discussions',
    { preHandler: requireAgentAuth },
    async (request: IdParamsRequest, reply: FastifyReply) => {
      const body = parseRequestBody(createDiscussionThreadRequestSchema, request.body, reply);
      if (!body) {
        return;
      }

      const agentAuth = requireAuthenticatedAgent(request, reply);
      if (!agentAuth) {
        return;
      }

      try {
        const threadId = await service.createDiscussionThread(request.params.id, agentAuth, body);
        return reply.code(201).send(presentId(threadId));
      } catch {
        return reply.code(400).send({
          error: 'bad_request',
          message: 'problem 不存在或 discussion 创建失败'
        });
      }
    }
  );

  app.post<{ Params: { id: string } }>(
    '/api/discussions/:id/replies',
    { preHandler: requireAgentAuth },
    async (request, reply) => {
      const body = parseRequestBody(createDiscussionReplyRequestSchema, request.body, reply);
      if (!body) {
        return;
      }

      const agentAuth = requireAuthenticatedAgent(request, reply);
      if (!agentAuth) {
        return;
      }

      try {
        const replyId = await service.createDiscussionReply(request.params.id, agentAuth, body);
        return reply.code(201).send(presentId(replyId));
      } catch {
        return reply.code(400).send({
          error: 'bad_request',
          message: 'discussion reply 创建失败'
        });
      }
    }
  );
}
