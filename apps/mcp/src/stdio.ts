import 'dotenv/config';

import { loadMcpEnv } from './config/env.js';
import { connectCausalityMcpStdioServer } from './transports/stdioServer.js';

const env = loadMcpEnv();

try {
  if (!env.CAUSALITY_MCP_LEGACY_TOKEN) {
    throw new Error('CAUSALITY_MCP_LEGACY_TOKEN is required for stdio compatibility');
  }
  await connectCausalityMcpStdioServer({
    apiBaseUrl: env.CAUSALITY_API_URL,
    apiTimeoutMs: env.CAUSALITY_API_TIMEOUT_MS,
    token: env.CAUSALITY_MCP_LEGACY_TOKEN,
    internalSecret: env.CAUSALITY_INTERNAL_MCP_SECRET,
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Causality MCP stdio startup failed');
  process.exitCode = 1;
}
