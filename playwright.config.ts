import { defineConfig } from '@playwright/test';

const databaseUrl = process.env.DATABASE_URL;
let parsedDatabaseUrl: URL | undefined;
try {
  parsedDatabaseUrl = databaseUrl ? new URL(databaseUrl) : undefined;
} catch {
  parsedDatabaseUrl = undefined;
}
const databaseName = parsedDatabaseUrl?.pathname.slice(1) ?? '';
const apiPort = process.env.E2E_API_PORT ?? '3200';
const webPort = process.env.E2E_WEB_PORT ?? '5274';
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const webOrigin = `http://127.0.0.1:${webPort}`;

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
  globalSetup: './tests/e2e/globalSetup.ts',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: webOrigin,
    viewport: { width: 1280, height: 720 },
    trace: 'retain-on-failure',
    storageState: 'tests/e2e/.auth/user.json',
  },
  webServer: [
    {
      command: 'corepack pnpm --filter @causality/api dev',
      url: `${apiOrigin}/api/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        NODE_ENV: 'test',
        HOST: '127.0.0.1',
        PORT: apiPort,
        DATABASE_URL: databaseUrl,
        LOG_LEVEL: 'silent',
        CORS_ORIGIN: webOrigin,
        CAUSALITY_PUBLIC_ORIGIN: webOrigin,
        CAUSALITY_INTERNAL_MCP_SECRET: 'ef'.repeat(32),
        CAUSALITY_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 0x74).toString('base64'),
      },
    },
    {
      command: 'corepack pnpm --filter @causality/web dev',
      url: webOrigin,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        WEB_PORT: webPort,
        API_PROXY_URL: apiOrigin,
        E2E_WEB_ORIGIN: webOrigin,
      },
    },
  ],
});
