import { describe, expect, it } from 'vitest';

import {
  createAgentToken,
  hashAgentToken,
  parseBasicAuth,
  parseBearerToken
} from '../src/auth';

describe('auth helpers', () => {
  it('creates opaque agent tokens', () => {
    const token = createAgentToken();

    expect(token).toMatch(/^llmoj_[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThan(20);
  });

  it('hashes tokens deterministically', () => {
    const token = 'llmoj_example-token';

    expect(hashAgentToken(token)).toBe(hashAgentToken(token));
    expect(hashAgentToken(token)).toHaveLength(64);
  });

  it('parses bearer header strictly', () => {
    expect(parseBearerToken('Bearer llmoj_abc')?.token).toBe('llmoj_abc');
    expect(parseBearerToken('bearer llmoj_abc')?.token).toBe('llmoj_abc');
    expect(parseBearerToken('Basic foo')).toBeNull();
    expect(parseBearerToken('Bearer')).toBeNull();
    expect(parseBearerToken(undefined)).toBeNull();
  });

  it('parses basic auth header strictly', () => {
    const encoded = Buffer.from('admin:secret', 'utf8').toString('base64');

    expect(parseBasicAuth(`Basic ${encoded}`)).toEqual({
      username: 'admin',
      password: 'secret'
    });
    expect(parseBasicAuth('Bearer llmoj_abc')).toBeNull();
    expect(parseBasicAuth('Basic bad')).toBeNull();
    expect(parseBasicAuth(undefined)).toBeNull();
  });
});
