import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  registerKnowledgeTools,
  type CausalityKnowledgeApi,
} from '../tools/registerKnowledgeTools.js';

export interface CreateCausalityMcpServerOptions {
  apiClient: CausalityKnowledgeApi;
}

export function createCausalityMcpServer(options: CreateCausalityMcpServerOptions): McpServer {
  const server = new McpServer({
    name: 'causality',
    version: '0.1.0',
  });
  registerKnowledgeTools(server, options.apiClient);
  return server;
}
