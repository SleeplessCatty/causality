import { mcpSettingsResponseSchema } from '@causality/contracts';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { CausalityApiClient } from '../api/causalityApiClient.js';
import type { McpLogger } from '../observability/mcpRequestLogging.js';
import { createCausalityMcpServer } from '../server/createMcpServer.js';
import { ObservedTransport } from './observedTransport.js';

export interface ConnectCausalityMcpStdioServerOptions {
  apiBaseUrl: string;
  apiTimeoutMs?: number;
  fetch?: typeof fetch;
  transport?: Transport;
  logger?: McpLogger;
}

const stderrLogger: McpLogger = {
  info: (entry) => console.error(typeof entry === 'string' ? entry : JSON.stringify(entry)),
  error: (entry) => console.error(typeof entry === 'string' ? entry : JSON.stringify(entry)),
};

export async function connectCausalityMcpStdioServer(
  options: ConnectCausalityMcpStdioServerOptions,
) {
  const fetchImplementation = options.fetch ?? fetch;
  const response = await fetchImplementation(new URL('/api/mcp/settings', options.apiBaseUrl));
  if (!response.ok) {
    throw new Error(`Unable to load MCP settings (HTTP ${response.status})`);
  }
  const parsed = mcpSettingsResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error('MCP settings response is invalid');

  const apiClient = new CausalityApiClient({
    baseUrl: options.apiBaseUrl,
    token: parsed.data.accessToken,
    fetch: fetchImplementation,
    ...(options.apiTimeoutMs === undefined ? {} : { timeoutMs: options.apiTimeoutMs }),
  });
  const logger = options.logger ?? stderrLogger;
  const server = createCausalityMcpServer({ apiClient, logger });
  const transport = new ObservedTransport(options.transport ?? new StdioServerTransport(), logger);
  await server.connect(transport);
  return server;
}
