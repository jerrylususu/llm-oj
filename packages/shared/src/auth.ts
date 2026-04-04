import { createHash, randomBytes } from 'node:crypto';

export interface ParsedBearerToken {
  readonly token: string;
}

export function createAgentToken(): string {
  return `llmoj_${randomBytes(24).toString('base64url')}`;
}

export function hashAgentToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function parseBearerToken(value: string | undefined): ParsedBearerToken | null {
  if (!value) {
    return null;
  }

  const [scheme, token, extra] = value.trim().split(/\s+/);

  if (scheme?.toLowerCase() !== 'bearer' || !token || extra) {
    return null;
  }

  return { token };
}
