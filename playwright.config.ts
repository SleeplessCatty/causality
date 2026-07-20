import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results',
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    viewport: { width: 1280, height: 720 },
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'corepack pnpm --filter @causality/api dev',
      url: 'http://127.0.0.1:3000/api/health',
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        NODE_ENV: 'test',
        HOST: '127.0.0.1',
        PORT: '3000',
        DATABASE_URL: 'postgresql://causality:causality@127.0.0.1:5432/causality',
        LOG_LEVEL: 'silent',
        CORS_ORIGIN: 'http://127.0.0.1:5173',
      },
    },
    {
      command: 'corepack pnpm --filter @causality/web dev',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
