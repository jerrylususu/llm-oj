import path from 'node:path';
import { existsSync } from 'node:fs';

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
  const webDistRoot = path.resolve(process.cwd(), 'apps/web/dist');
  const hasWebDist = existsSync(webDistRoot);
  const service = createApiService({
    config: options.config,
    db: options.db
  });
  const requireAgentAuth = createAgentAuthPreHandler(options.db);
  const requireAdminAuth = createAdminAuthPreHandler(options.config);

  app.decorateRequest('agentAuth', null);

  if (hasWebDist) {
    void app.register(fastifyStatic, {
      root: webDistRoot,
      prefix: '/'
    });
  }

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
  registerPageRoutes(app, requireAdminAuth, { hasWebDist });

  return app;
}
