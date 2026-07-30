import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerCapturePrompt } from '../prompts/capturePrompt.js';
import { registerAnalysisPrompts } from '../prompts/registerAnalysisPrompts.js';
import {
  registerCaptureTools,
  type CausalityCaptureApi,
  type McpCaptureLogger,
} from '../tools/registerCaptureTools.js';
import {
  registerEvidenceTools,
  type CausalityEvidenceApi,
} from '../tools/registerEvidenceTools.js';
import {
  registerKnowledgeTools,
  type CausalityKnowledgeApi,
} from '../tools/registerKnowledgeTools.js';

export type CausalityMcpApi = CausalityKnowledgeApi & CausalityEvidenceApi & CausalityCaptureApi;

export interface CreateCausalityMcpServerOptions {
  apiClient: CausalityMcpApi;
  logger?: McpCaptureLogger;
}

export function createCausalityMcpServer(options: CreateCausalityMcpServerOptions): McpServer {
  const server = new McpServer({
    name: 'causality',
    version: '0.1.0',
  });
  registerKnowledgeTools(server, options.apiClient);
  registerEvidenceTools(server, options.apiClient);
  registerCaptureTools(server, options.apiClient, options.logger);
  registerCapturePrompt(server);
  registerAnalysisPrompts(server);
  return server;
}
