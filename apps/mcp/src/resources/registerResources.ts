import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { MCP_RESOURCE_URIS } from '../capabilities/capabilityManifest.js';
import {
  buildCapabilitiesResource,
  buildCaptureRulesResource,
  buildDomainModelResource,
} from './staticResourceContent.js';

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
