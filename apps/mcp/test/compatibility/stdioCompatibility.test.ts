import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, describe, expect, it } from 'vitest';

import {
  MCP_PROMPT_NAMES,
  MCP_RESOURCE_URIS,
  MCP_TOOL_NAMES,
} from '../../src/capabilities/capabilityManifest.js';

const token = `cau_pat_${'3'.repeat(43)}`;
const internalSecret = '4'.repeat(64);
const missingEventId = '00000000-0000-4000-8000-000000000000';
const stdioEntry = fileURLToPath(new URL('../../dist/stdio.js', import.meta.url));

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

describe('stdio process wire compatibility', () => {
  const clients: Client[] = [];
  const apiServers: Server[] = [];

  afterEach(async () => {
    await Promise.allSettled(clients.splice(0).map((client) => client.close()));
    await Promise.all(apiServers.splice(0).map(closeServer));
  });

  it('exposes the same portable surface and structured errors through the built process', async () => {
    const api = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      response.setHeader('content-type', 'application/json');
      if (url.pathname === '/internal/mcp/events') {
        response.end(
          JSON.stringify({
            items: [],
            page: 1,
            pageSize: 50,
            totalItems: 0,
            totalPages: 1,
            semanticIndexNotice: null,
          }),
        );
        return;
      }
      if (url.pathname.startsWith(`/internal/mcp/events/${missingEventId}`)) {
        response.statusCode = 404;
        response.end(JSON.stringify({ code: 'EVENT_NOT_FOUND', message: '原子事件不存在' }));
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ code: 'NOT_FOUND', message: 'not found' }));
    });
    await listen(api);
    apiServers.push(api);
    const address = api.address() as AddressInfo;
    const stderr: string[] = [];
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [stdioEntry],
      env: {
        ...getDefaultEnvironment(),
        CAUSALITY_API_URL: `http://127.0.0.1:${address.port}`,
        CAUSALITY_MCP_TOKEN: token,
        CAUSALITY_INTERNAL_MCP_SECRET: internalSecret,
      },
      stderr: 'pipe',
    });
    transport.stderr?.on('data', (chunk) => stderr.push(String(chunk)));
    const client = new Client({ name: 'stdio-wire-client', version: '1.0.0' });
    clients.push(client);
    await client.connect(transport);

    const [tools, prompts, resources] = await Promise.all([
      client.listTools(),
      client.listPrompts(),
      client.listResources(),
    ]);
    const prompt = await client.getPrompt({ name: MCP_PROMPT_NAMES.analyzeEvent });
    const resource = await client.readResource({ uri: MCP_RESOURCE_URIS.capabilities });
    const searched = await client.callTool({
      name: MCP_TOOL_NAMES.searchAtomicEvents,
      arguments: { query: 'stdio-wire-private', page: 1, searchMode: 'standard' },
    });
    const missing = await client.callTool({
      name: MCP_TOOL_NAMES.getAtomicEvent,
      arguments: { eventId: missingEventId },
    });

    expect(tools.tools.map((item) => item.name)).toEqual(Object.values(MCP_TOOL_NAMES));
    expect(prompts.prompts.map((item) => item.name)).toEqual(Object.values(MCP_PROMPT_NAMES));
    expect(resources.resources.map((item) => item.uri)).toEqual(Object.values(MCP_RESOURCE_URIS));
    expect(prompt.messages).toHaveLength(1);
    expect(resource.contents).toHaveLength(1);
    expect(searched).toMatchObject({ structuredContent: { totalItems: 0 } });
    expect(missing).toMatchObject({
      isError: true,
      structuredContent: {
        error: { code: 'EVENT_NOT_FOUND', category: 'not_found', retryable: false },
      },
    });

    await client.close();
    clients.splice(clients.indexOf(client), 1);
    const logText = stderr.join('');
    expect(logText).toContain('tools/call');
    expect(logText).toContain('search_atomic_events');
    expect(logText).not.toContain(token);
    expect(logText).not.toContain('stdio-wire-private');
  }, 15_000);
});
