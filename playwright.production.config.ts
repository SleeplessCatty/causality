import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/production',
  testMatch: 'production-smoke.spec.ts',
  outputDir: './test-results/production',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env.PRODUCTION_BASE_URL ?? 'http://127.0.0.1:18080',
    viewport: { width: 1280, height: 720 },
    trace: 'retain-on-failure',
  },
});
