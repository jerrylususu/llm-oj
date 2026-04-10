import type {
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler
} from 'fastify';
import type { Pool } from 'pg';
import type { ZodType } from 'zod';

import { authenticateAgentToken } from '@llm-oj/db';
import { parseBasicAuth, parseBearerToken, type ServiceConfig } from '@llm-oj/shared';

export interface AgentAuth {
  readonly agentId: string;
  readonly tokenId: string;
  readonly name: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    agentAuth: AgentAuth | null;
  }
}

function zodMessage(error: { issues: Array<{ message: string }> }): string {
  const firstIssue = error.issues[0];

  if (!firstIssue) {
    return '请求体不合法';
  }

  return firstIssue.message;
}

export function createAgentAuthPreHandler(db: Pool): preHandlerAsyncHookHandler {
  return async function requireAgentAuth(request, reply): Promise<void> {
    const parsed = parseBearerToken(request.headers.authorization);

    if (!parsed) {
      void reply.code(401).send({
        error: 'unauthorized',
        message: '缺少有效的 Bearer token'
      });
      return;
    }

    const authenticated = await authenticateAgentToken(db, parsed.token);

    if (!authenticated) {
      void reply.code(401).send({
        error: 'unauthorized',
        message: 'token 无效或已被撤销'
      });
      return;
    }

    request.agentAuth = authenticated;
  };
}

export function createAdminAuthPreHandler(config: ServiceConfig): preHandlerAsyncHookHandler {
  return async function requireAdminAuth(request, reply): Promise<void> {
    const parsed = parseBasicAuth(request.headers.authorization);

    if (
      !parsed ||
      parsed.username !== config.env.ADMIN_USERNAME ||
      parsed.password !== config.env.ADMIN_PASSWORD
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
  };
}

export function parseRequestBody<T>(
  schema: ZodType<T>,
  payload: unknown,
  reply: FastifyReply
): T | null {
  const parsed = schema.safeParse(payload);

  if (!parsed.success) {
    void reply.code(400).send({
      error: 'bad_request',
      message: zodMessage(parsed.error)
    });
    return null;
  }

  return parsed.data;
}

export function requireAuthenticatedAgent<
  TRequest extends FastifyRequest,
  TReply extends FastifyReply
>(
  request: TRequest,
  reply: TReply
): AgentAuth | null {
  if (!request.agentAuth) {
    void reply.code(401).send({
      error: 'unauthorized',
      message: 'token 无效或已被撤销'
    });
    return null;
  }

  return request.agentAuth;
}
