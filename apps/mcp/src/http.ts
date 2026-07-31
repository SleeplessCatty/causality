import 'dotenv/config';

import { loadMcpEnv } from './config/env.js';
import { startCausalityMcpHttpServer } from './transports/httpServer.js';

const env = loadMcpEnv();

try {
  const server = await startCausalityMcpHttpServer({
    apiBaseUrl: env.CAUSALITY_API_URL,
    apiTimeoutMs: env.CAUSALITY_API_TIMEOUT_MS,
    internalSecret: env.CAUSALITY_INTERNAL_MCP_SECRET,
    host: env.HOST,
    port: env.PORT,
    allowedOrigins: env.CAUSALITY_MCP_ALLOWED_ORIGINS,
    maxBodyBytes: env.CAUSALITY_MCP_MAX_BODY_BYTES,
  });

  const shutdown = async () => {
    await server.close();
    process.exitCode = 0;
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Causality MCP HTTP startup failed');
  process.exitCode = 1;
}
