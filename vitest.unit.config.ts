import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    exclude: ['**/*.integration.test.ts'],
    include: ['apps/*/test/**/*.test.ts', 'packages/*/test/**/*.test.ts']
  }
});
