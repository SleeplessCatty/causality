import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { CAUSALITY_MCP_VERSION, MCP_RESOURCE_URIS } from '../capabilities/capabilityManifest.js';
import {
  buildCapabilitiesResource,
  buildCaptureRulesResource,
  buildDomainModelResource,
} from './staticResourceContent.js';
import { buildSystemStatusResource, type CausalityStatusApi } from './systemStatusResource.js';

export function registerStaticResources(server: McpServer): void {
  server.registerResource(
    'causality-domain-model-rules',
    MCP_RESOURCE_URIS.domainModel,
    {
      title: 'Causality 领域建模规则',
      description: '原子事件、具体案例、直接与间接关系及证据边界。',
      mimeType: 'text/markdown',
    },
    async () => ({
      contents: [
        {
          uri: MCP_RESOURCE_URIS.domainModel,
          mimeType: 'text/markdown',
          text: buildDomainModelResource(),
        },
      ],
    }),
  );

  server.registerResource(
    'causality-capture-rules',
    MCP_RESOURCE_URIS.captureRules,
    {
      title: 'Causality 会话采集规则',
      description: '当前 V2 会话采集与受控入库规则。',
      mimeType: 'text/markdown',
    },
    async () => ({
      contents: [
        {
          uri: MCP_RESOURCE_URIS.captureRules,
          mimeType: 'text/markdown',
          text: buildCaptureRulesResource(),
        },
      ],
    }),
  );

  server.registerResource(
    'causality-capabilities',
    MCP_RESOURCE_URIS.capabilities,
    {
      title: 'Causality MCP 能力清单',
      description: '工具、Prompt、Resource 和稳定查询限制。',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [
        {
          uri: MCP_RESOURCE_URIS.capabilities,
          mimeType: 'application/json',
          text: buildCapabilitiesResource(),
        },
      ],
    }),
  );
}

export function registerResources(server: McpServer, api: CausalityStatusApi): void {
  registerStaticResources(server);
  server.registerResource(
    'causality-system-status',
    MCP_RESOURCE_URIS.systemStatus,
    {
      title: 'Causality 本地系统状态',
      description: '实时读取 API、数据库、语义 Worker、模型和索引可用状态。',
      mimeType: 'application/json',
    },
    async () => {
      const status = await buildSystemStatusResource(api, {
        now: () => new Date(),
        serverVersion: CAUSALITY_MCP_VERSION,
      });
      return {
        contents: [
          {
            uri: MCP_RESOURCE_URIS.systemStatus,
            mimeType: 'application/json',
            text: JSON.stringify(status, null, 2),
          },
        ],
      };
    },
  );
}
