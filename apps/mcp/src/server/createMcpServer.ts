import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerCapturePrompt } from '../prompts/capturePrompt.js';
import { registerCaptureTools, type CausalityCaptureApi } from '../tools/registerCaptureTools.js';
import {
  registerKnowledgeTools,
  type CausalityKnowledgeApi,
} from '../tools/registerKnowledgeTools.js';

export type CausalityMcpApi = CausalityKnowledgeApi & CausalityCaptureApi;

export interface CreateCausalityMcpServerOptions {
  apiClient: CausalityMcpApi;
}

export function createCausalityMcpServer(options: CreateCausalityMcpServerOptions): McpServer {
  const server = new McpServer({
    name: 'causality',
    version: '0.1.0',
  });
  registerKnowledgeTools(server, options.apiClient);
  registerCaptureTools(server, options.apiClient);
  registerCapturePrompt(server);
  return server;
}
