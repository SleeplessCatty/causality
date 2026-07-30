import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { CAUSALITY_MCP_NAME, CAUSALITY_MCP_VERSION } from '../capabilities/capabilityManifest.js';
import { registerCapturePrompt } from '../prompts/capturePrompt.js';
import { registerAnalysisPrompts } from '../prompts/registerAnalysisPrompts.js';
import { registerResources } from '../resources/registerResources.js';
import type { CausalityStatusApi } from '../resources/systemStatusResource.js';
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

export type CausalityMcpApi = CausalityKnowledgeApi &
  CausalityEvidenceApi &
  CausalityCaptureApi &
  CausalityStatusApi;

export interface CreateCausalityMcpServerOptions {
  apiClient: CausalityMcpApi;
  logger?: McpCaptureLogger;
}

export function createCausalityMcpServer(options: CreateCausalityMcpServerOptions): McpServer {
  const server = new McpServer({
    name: CAUSALITY_MCP_NAME,
    version: CAUSALITY_MCP_VERSION,
  });
  registerKnowledgeTools(server, options.apiClient);
  registerEvidenceTools(server, options.apiClient);
  registerCaptureTools(server, options.apiClient, options.logger);
  registerCapturePrompt(server);
  registerAnalysisPrompts(server);
  registerResources(server, options.apiClient);
  return server;
}
