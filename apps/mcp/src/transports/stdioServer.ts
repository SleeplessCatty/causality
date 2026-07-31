import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { CausalityApiClient } from '../api/causalityApiClient.js';
import type { McpLogger } from '../observability/mcpRequestLogging.js';
import { createCausalityMcpServer } from '../server/createMcpServer.js';
import { ObservedTransport } from './observedTransport.js';

export interface ConnectCausalityMcpStdioServerOptions {
  apiBaseUrl: string;
  apiTimeoutMs?: number;
  token: string;
  internalSecret: string;
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
  const apiClient = new CausalityApiClient({
    baseUrl: options.apiBaseUrl,
    token: options.token,
    internalSecret: options.internalSecret,
    fetch: fetchImplementation,
    ...(options.apiTimeoutMs === undefined ? {} : { timeoutMs: options.apiTimeoutMs }),
  });
  const logger = options.logger ?? stderrLogger;
  const server = createCausalityMcpServer({ apiClient, logger });
  const transport = new ObservedTransport(options.transport ?? new StdioServerTransport(), logger);
  await server.connect(transport);
  return server;
}
