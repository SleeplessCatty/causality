import { loadMcpEnv } from './config/env.js';
import { connectCausalityMcpStdioServer } from './transports/stdioServer.js';

const env = loadMcpEnv();

try {
  await connectCausalityMcpStdioServer({
    apiBaseUrl: env.CAUSALITY_API_URL,
    apiTimeoutMs: env.CAUSALITY_API_TIMEOUT_MS,
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Causality MCP stdio startup failed');
  process.exitCode = 1;
}
