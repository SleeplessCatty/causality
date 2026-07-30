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
import { registerStaticResources } from '../src/resources/registerResources.js';
import { capabilityManifestSchema } from '../src/resources/resourceSchemas.js';

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
    registerStaticResources(server);
    client = new Client({ name: 'resource-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it('lists the three fixed static resources with exact MIME types', async () => {
    const listed = await client.listResources();

    expect(listed.resources.map((resource) => [resource.uri, resource.mimeType])).toEqual([
      [MCP_RESOURCE_URIS.domainModel, 'text/markdown'],
      [MCP_RESOURCE_URIS.captureRules, 'text/markdown'],
      [MCP_RESOURCE_URIS.capabilities, 'application/json'],
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
});
