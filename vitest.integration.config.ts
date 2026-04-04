import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    hookTimeout: 15000,
    include: [
      'apps/*/test/**/*.integration.test.ts',
      'packages/*/test/**/*.integration.test.ts',
      'tests/**/*.integration.test.ts'
    ],
    testTimeout: 15000
  }
});
