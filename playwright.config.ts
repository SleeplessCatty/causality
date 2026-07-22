import { defineConfig } from '@playwright/test';

const databaseUrl = process.env.DATABASE_URL;
let parsedDatabaseUrl: URL | undefined;
try {
  parsedDatabaseUrl = databaseUrl ? new URL(databaseUrl) : undefined;
} catch {
  parsedDatabaseUrl = undefined;
}
const databaseName = parsedDatabaseUrl?.pathname.slice(1) ?? '';

if (
  parsedDatabaseUrl?.protocol !== 'postgresql:' ||
  parsedDatabaseUrl.username !== 'causality' ||
  parsedDatabaseUrl.password !== 'causality' ||
  parsedDatabaseUrl.hostname !== '127.0.0.1' ||
  parsedDatabaseUrl.port !== '5432' ||
  !/^causality_e2e_test_[0-9]+$/.test(databaseName)
) {
  throw new Error('Playwright must run through pnpm test:e2e with a unique E2E database');
}

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
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
        DATABASE_URL: databaseUrl,
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
