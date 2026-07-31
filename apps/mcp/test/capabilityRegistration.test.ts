import { afterEach, describe, expect, it } from 'vitest';

import {
  MCP_CAPABILITY_COUNTS,
  MCP_PROMPT_NAMES,
  MCP_RESOURCE_URIS,
  MCP_TOOL_NAMES,
} from '../src/capabilities/capabilityManifest.js';
import type { CausalityMcpApi } from '../src/server/createMcpServer.js';
import {
  connectTestMcpClient,
  type ConnectedTestMcpClient,
} from './support/connectTestMcpClient.js';

describe('registered MCP capabilities', () => {
  let connection: ConnectedTestMcpClient | undefined;

  afterEach(async () => {
    await connection?.close();
    connection = undefined;
  });

  it('exposes the exact manifest Tools, Prompts, and Resources', async () => {
    connection = await connectTestMcpClient({} as CausalityMcpApi);

    const [tools, prompts, resources] = await Promise.all([
      connection.client.listTools(),
      connection.client.listPrompts(),
      connection.client.listResources(),
    ]);

    expect(tools.tools.map(({ name }) => name)).toEqual(Object.values(MCP_TOOL_NAMES));
    expect(prompts.prompts.map(({ name }) => name)).toEqual(Object.values(MCP_PROMPT_NAMES));
    expect(resources.resources.map(({ uri }) => uri)).toEqual(Object.values(MCP_RESOURCE_URIS));
    expect(tools.tools).toHaveLength(MCP_CAPABILITY_COUNTS.tools);
    expect(prompts.prompts).toHaveLength(MCP_CAPABILITY_COUNTS.prompts);
    expect(resources.resources).toHaveLength(MCP_CAPABILITY_COUNTS.resources);
  });
});
