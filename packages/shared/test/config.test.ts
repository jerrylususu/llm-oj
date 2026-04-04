import { describe, expect, it } from 'vitest';

import { createServiceConfig, loadEnv } from '../src/config';

describe('loadEnv', () => {
  it('applies defaults', () => {
    const env = loadEnv({
      DATABASE_URL: 'http://127.0.0.1:5432/llm_oj'
    });

    expect(env.NODE_ENV).toBe('development');
    expect(env.API_PORT).toBe(3000);
    expect(env.WORKER_POLL_INTERVAL_MS).toBe(3000);
    expect(env.RUNNER_MODE).toBe('docker');
    expect(env.RUNNER_PYTHON_IMAGE).toBe('python:3.12-alpine');
    expect(env.RUNNER_TIMEOUT_SEC).toBe(30);
    expect(env.STORAGE_ROOT).toBe('storage');
    expect(env.PROBLEMS_ROOT).toBe('examples/problems');
  });

  it('rejects invalid database url', () => {
    expect(() =>
      loadEnv({
        DATABASE_URL: 'not-a-url'
      })
    ).toThrowError(/环境变量校验失败/);
  });
});

describe('createServiceConfig', () => {
  it('tags config with service name', () => {
    const config = createServiceConfig('api', {
      DATABASE_URL: 'http://127.0.0.1:5432/llm_oj',
      NODE_ENV: 'test'
    });

    expect(config.serviceName).toBe('api');
    expect(config.env.NODE_ENV).toBe('test');
  });
});
