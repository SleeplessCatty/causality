import 'dotenv/config';

import { buildApp } from './app.js';
import { parseEnv } from './config/env.js';
import { createDatabasePool } from './database/pool.js';
import { isDatabaseReady } from './database/readiness.js';

const env = parseEnv(process.env);
const pool = createDatabasePool(env.DATABASE_URL);
const app = buildApp({
  corsOrigin: env.CORS_ORIGIN,
  checkDatabase: () => isDatabaseReady(pool),
  databasePool: pool,
  semanticWorkerUrl: env.SEMANTIC_WORKER_URL,
  semanticQueryTimeoutMs: env.SEMANTIC_QUERY_TIMEOUT_MS,
  aiCaptureTimeoutMs: env.AI_CAPTURE_TIMEOUT_MS,
  mcpEndpoint: env.CAUSALITY_MCP_ENDPOINT,
  mcpHealthUrl: env.CAUSALITY_MCP_HEALTH_URL,
  mcpHealthTimeoutMs: env.CAUSALITY_MCP_HEALTH_TIMEOUT_MS,
  publicOrigin: env.CAUSALITY_PUBLIC_ORIGIN,
  cookieSecure: env.CAUSALITY_COOKIE_SECURE,
  sessionHmacKey: env.CAUSALITY_SESSION_HMAC_KEY,
  authIpHashKey: env.CAUSALITY_AUTH_IP_HASH_KEY,
  logger:
    env.NODE_ENV === 'development'
      ? {
          level: env.LOG_LEVEL,
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:standard' },
          },
        }
      : { level: env.LOG_LEVEL },
});

let isShuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  app.log.info({ signal }, 'Shutting down');
  await app.close();
  await pool.end();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown(signal).catch((error: unknown) => {
      app.log.error(error, 'Graceful shutdown failed');
      process.exitCode = 1;
    });
  });
}

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (error) {
  app.log.error(error, 'API failed to start');
  await pool.end();
  process.exitCode = 1;
}
