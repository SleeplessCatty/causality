import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.integration.test.ts'],
    globalSetup: ['./test/support/workerIntegrationGlobalSetup.ts'],
    fileParallelism: false,
    clearMocks: true,
    hookTimeout: 120_000,
    testTimeout: 120_000,
  },
});
