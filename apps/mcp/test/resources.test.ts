import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  MCP_CAPABILITY_MANIFEST,
  MCP_RESOURCE_URIS,
} from '../src/capabilities/capabilityManifest.js';
import { buildDomainModelRules } from '../src/prompts/analysisPolicy.js';
import { buildCausalityCapturePrompt } from '../src/prompts/capturePrompt.js';
import { registerResources } from '../src/resources/registerResources.js';
import {
  capabilityManifestSchema,
  systemStatusResourceSchema,
} from '../src/resources/resourceSchemas.js';

const timestamp = '2026-07-30T12:00:00.000Z';
const statusApi = {
  getHealth: async (): Promise<HealthResponse> => ({ status: 'ok', service: 'causality-api' }),
  getReadiness: async (): Promise<ReadinessResponse> => ({
    status: 'ready',
    database: 'available',
  }),
  getSemanticLifecycle: async (): Promise<SemanticLifecycleSnapshot> => ({
    currentModelCode: null,
    models: [],
    index: {
      status: 'empty',
      processedItems: 0,
      totalItems: 0,
      pendingItems: 0,
      failedItems: 0,
      availableForEnhancedSearch: false,
      failure: null,
      updatedAt: null,
    },
    operation: null,
    worker: {
      status: 'online',
      modelState: 'idle',
      loadedModelCode: null,
      checkedAt: timestamp,
    },
    pollAfterMs: null,
    updatedAt: timestamp,
  }),
};

function textOf(result: Awaited<ReturnType<Client['readResource']>>): string {
  const content = result.contents[0];
  if (!content || !('text' in content)) throw new Error('Expected text resource content');
  return content.text;
}

describe('static MCP resources', () => {
  let client: Client;
  let server: McpServer;

  beforeEach(async () => {
    server = new McpServer({ name: 'resource-test', version: '1.0.0' });
    registerResources(server, statusApi);
    client = new Client({ name: 'resource-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client?.close();
    await server?.close();
  });

  it('lists all four fixed resources with exact MIME types', async () => {
    const listed = await client.listResources();

    expect(listed.resources.map((resource) => [resource.uri, resource.mimeType])).toEqual([
      [MCP_RESOURCE_URIS.domainModel, 'text/markdown'],
      [MCP_RESOURCE_URIS.captureRules, 'text/markdown'],
      [MCP_RESOURCE_URIS.capabilities, 'application/json'],
      [MCP_RESOURCE_URIS.systemStatus, 'application/json'],
    ]);
  });

  it('reads canonical domain and capture rules without a second source', async () => {
    const [domain, capture] = await Promise.all([
      client.readResource({ uri: MCP_RESOURCE_URIS.domainModel }),
      client.readResource({ uri: MCP_RESOURCE_URIS.captureRules }),
    ]);

    expect(textOf(domain)).toBe(buildDomainModelRules());
    expect(textOf(capture)).toBe(buildCausalityCapturePrompt());
  });

  it('returns a strict final capability manifest', async () => {
    const result = await client.readResource({ uri: MCP_RESOURCE_URIS.capabilities });
    const parsed = capabilityManifestSchema.parse(JSON.parse(textOf(result)));

    expect(parsed).toEqual(MCP_CAPABILITY_MANIFEST);
    expect(parsed.tools).toHaveLength(15);
    expect(parsed.prompts).toHaveLength(4);
    expect(parsed.resources).toHaveLength(4);
  });

  it('returns strict live status without exposing API details', async () => {
    const result = await client.readResource({ uri: MCP_RESOURCE_URIS.systemStatus });
    const parsed = systemStatusResourceSchema.parse(JSON.parse(textOf(result)));

    expect(parsed).toMatchObject({
      overallStatus: 'degraded',
      enhancedQuery: { available: false, reason: 'model_not_selected' },
    });
  });
});
import type {
  HealthResponse,
  ReadinessResponse,
  SemanticLifecycleSnapshot,
} from '@causality/contracts';
