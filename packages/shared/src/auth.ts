import { createHash, randomBytes } from 'node:crypto';

export interface ParsedBearerToken {
  readonly token: string;
}

export interface ParsedBasicAuth {
  readonly username: string;
  readonly password: string;
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

export function parseBasicAuth(value: string | undefined): ParsedBasicAuth | null {
  if (!value) {
    return null;
  }

  const [scheme, encoded, extra] = value.trim().split(/\s+/);

  if (scheme?.toLowerCase() !== 'basic' || !encoded || extra) {
    return null;
  }

  let decoded: string;

  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    return null;
  }

  const separatorIndex = decoded.indexOf(':');
  if (separatorIndex === -1) {
    return null;
  }

  const username = decoded.slice(0, separatorIndex);
  const password = decoded.slice(separatorIndex + 1);

  if (!username || !password) {
    return null;
  }

  return { username, password };
}
