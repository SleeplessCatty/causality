import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { MCP_PROMPT_NAMES } from '../capabilities/capabilityManifest.js';
import { buildAnalyzeEventPrompt } from './analyzeEventPrompt.js';
import { buildReviewChainPrompt } from './reviewChainPrompt.js';
import { buildTracePathPrompt } from './tracePathPrompt.js';

function promptMessage(text: string) {
  return [{ role: 'user' as const, content: { type: 'text' as const, text } }];
}

export function registerAnalysisPrompts(server: McpServer): void {
  server.registerPrompt(
    MCP_PROMPT_NAMES.analyzeEvent,
    {
      title: '分析事件的直接原因与结果',
      description: '从当前可见会话识别目标事件，并用 Causality 数据库分析直接原因或结果。',
    },
    async () => ({
      description: 'Causality 事件原因与结果分析流程',
      messages: promptMessage(buildAnalyzeEventPrompt()),
    }),
  );

  server.registerPrompt(
    MCP_PROMPT_NAMES.tracePath,
    {
      title: '追踪两个事件之间的因果路径',
      description: '从当前可见会话识别起点和终点，并查询受限有向路径及主要证据。',
    },
    async () => ({
      description: 'Causality 有向因果路径追踪流程',
      messages: promptMessage(buildTracePathPrompt()),
    }),
  );

  server.registerPrompt(
    MCP_PROMPT_NAMES.reviewChain,
    {
      title: '逐段审查因果链',
      description: '从当前可见会话提取用户主张的因果链，并逐段检查库内支持情况。',
    },
    async () => ({
      description: 'Causality 因果链逐段审查流程',
      messages: promptMessage(buildReviewChainPrompt()),
    }),
  );
}
