import path from 'node:path';

import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import type { Logger } from 'pino';

import type { ServiceConfig } from '@llm-oj/shared';

import { createAdminAuthPreHandler, createAgentAuthPreHandler } from './http';
import { registerApiRoutes } from './routes/api-routes';
import { registerPageRoutes } from './routes/page-routes';
import { createApiService } from './services';

export interface CreateApiAppOptions {
  readonly config: ServiceConfig;
  readonly db: Pool;
  readonly logger: Logger;
}

export function createApiApp(options: CreateApiAppOptions) {
  const app = Fastify({
    loggerInstance: options.logger
  });
  const service = createApiService({
    config: options.config,
    db: options.db
  });
  const requireAgentAuth = createAgentAuthPreHandler(options.db);
  const requireAdminAuth = createAdminAuthPreHandler(options.config);

  app.decorateRequest('agentAuth', null);

  void app.register(fastifyStatic, {
    root: path.resolve(process.cwd(), 'node_modules/monaco-editor/min'),
    prefix: '/assets/monaco/'
  });

  app.addHook('onReady', async () => {
    await service.seedProblemsOnReady();
  });

  registerApiRoutes({
    app,
    service,
    config: options.config,
    requireAgentAuth,
    requireAdminAuth
  });
  registerPageRoutes(app, service, requireAdminAuth);

  return app;
}
