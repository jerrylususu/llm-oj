import type { IncomingMessage, Server, ServerResponse } from 'node:http';

import type {
  FastifyInstance,
  FastifyReply,
  preHandlerAsyncHookHandler
} from 'fastify';
import type { Logger } from 'pino';

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

function renderWebUnavailablePage(): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Web build unavailable</title>
  </head>
  <body>
    <h1>Web build unavailable</h1>
    <p>未找到 apps/web/dist，请先执行 <code>npm run build:web</code>，或使用 <code>npm run dev:web</code> 启动独立前端。</p>
  </body>
</html>`;
}

async function serveWebApp(
  reply: FastifyReply,
  options: { readonly hasWebDist: boolean }
): Promise<FastifyReply> {
  if (!options.hasWebDist) {
    return reply
      .code(503)
      .type('text/html; charset=utf-8')
      .send(renderWebUnavailablePage());
  }

  return reply.type('text/html; charset=utf-8').sendFile('index.html');
}

export function registerPageRoutes(
  app: RouteApp,
  requireAdminAuth: preHandlerAsyncHookHandler,
  options: { readonly hasWebDist: boolean }
): void {
  app.get('/', async (_request, reply) => serveWebApp(reply, options));

  app.get('/admin', { preHandler: requireAdminAuth }, async (_request, reply) => {
    return reply.type('text/html; charset=utf-8').send(renderAdminConsolePage());
  });

  app.get('/problems/:id', async (_request, reply) => serveWebApp(reply, options));
  app.get('/problems/:id/submissions', async (_request, reply) => serveWebApp(reply, options));
  app.get('/problems/:id/leaderboard', async (_request, reply) => serveWebApp(reply, options));
  app.get('/problems/:id/discussions', async (_request, reply) => serveWebApp(reply, options));
  app.get('/submissions/:id', async (_request, reply) => serveWebApp(reply, options));
}
