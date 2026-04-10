import type { IncomingMessage, Server, ServerResponse } from 'node:http';

import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler
} from 'fastify';
import type { Logger } from 'pino';

import {
  renderDiscussionPage,
  renderLeaderboardPage,
  renderProblemCatalogPage,
  renderProblemPage,
  renderSubmissionPage,
  renderSubmissionsPage
} from '../ui';
import type { ApiService } from '../services';

function notFoundPage(kind: 'problem' | 'submission'): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" /><title>${kind} not found</title></head><body><h1>${kind} not found</h1></body></html>`;
}

function renderAdminConsolePage(): string {
  return `<!doctype html>
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
</html>`;
}

type RouteApp = FastifyInstance<
  Server,
  IncomingMessage,
  ServerResponse<IncomingMessage>,
  Logger
>;
type IdParamsRequest = FastifyRequest<{ Params: { id: string } }>;

export function registerPageRoutes(
  app: RouteApp,
  service: ApiService,
  requireAdminAuth: preHandlerAsyncHookHandler
): void {
  app.get('/', async (_request: FastifyRequest, reply: FastifyReply) => {
    const data = await service.getProblemCatalogPageData();
    return reply.type('text/html; charset=utf-8').send(renderProblemCatalogPage(data.problems));
  });

  app.get('/admin', { preHandler: requireAdminAuth }, async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.type('text/html; charset=utf-8').send(renderAdminConsolePage());
  });

  app.get<{ Params: { id: string } }>('/problems/:id', async (request: IdParamsRequest, reply: FastifyReply) => {
    const data = await service.getProblemPageData(request.params.id);

    if (!data) {
      return reply.code(404).type('text/html; charset=utf-8').send(notFoundPage('problem'));
    }

    return reply
      .type('text/html; charset=utf-8')
      .send(
        renderProblemPage({
          problem: data.problem,
          statementHtml: data.statementHtml,
          submissions: data.submissions,
          leaderboard: data.leaderboard,
          discussions: data.discussions
        })
      );
  });

  app.get<{ Params: { id: string } }>('/problems/:id/submissions', async (request: IdParamsRequest, reply: FastifyReply) => {
    const data = await service.getProblemSubmissionsPageData(request.params.id);

    if (!data) {
      return reply.code(404).type('text/html; charset=utf-8').send(notFoundPage('problem'));
    }

    return reply
      .type('text/html; charset=utf-8')
      .send(
        renderSubmissionsPage({
          problem: data.problem,
          submissions: data.submissions
        })
      );
  });

  app.get<{ Params: { id: string } }>('/problems/:id/leaderboard', async (request: IdParamsRequest, reply: FastifyReply) => {
    const data = await service.getProblemLeaderboardPageData(request.params.id);

    if (!data) {
      return reply.code(404).type('text/html; charset=utf-8').send(notFoundPage('problem'));
    }

    return reply
      .type('text/html; charset=utf-8')
      .send(
        renderLeaderboardPage({
          problem: data.problem,
          entries: data.entries
        })
      );
  });

  app.get<{ Params: { id: string } }>('/problems/:id/discussions', async (request: IdParamsRequest, reply: FastifyReply) => {
    const data = await service.getProblemDiscussionPageData(request.params.id);

    if (!data) {
      return reply.code(404).type('text/html; charset=utf-8').send(notFoundPage('problem'));
    }

    return reply
      .type('text/html; charset=utf-8')
      .send(
        renderDiscussionPage({
          problem: data.problem,
          threads: data.threads
        })
      );
  });

  app.get<{ Params: { id: string } }>('/submissions/:id', async (request: IdParamsRequest, reply: FastifyReply) => {
    const data = await service.getSubmissionPageData(request.params.id);

    if (!data) {
      return reply.code(404).type('text/html; charset=utf-8').send(notFoundPage('submission'));
    }

    return reply
      .type('text/html; charset=utf-8')
      .send(
        renderSubmissionPage({
          submission: data.submission,
          artifact: data.artifact
        })
      );
  });
}
