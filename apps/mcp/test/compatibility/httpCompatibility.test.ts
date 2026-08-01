import type { AddressInfo } from 'node:net';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MCP_PROMPT_NAMES,
  MCP_RESOURCE_URIS,
  MCP_TOOL_NAMES,
} from '../../src/capabilities/capabilityManifest.js';
import {
  startCausalityMcpHttpServer,
  type CausalityMcpHttpServer,
  type McpTransportLogger,
} from '../../src/transports/httpServer.js';

const validToken = `cau_pat_${'1'.repeat(43)}`;
const rotatedToken = `cau_pat_${'2'.repeat(43)}`;
const internalSecret = 'e'.repeat(64);
const missingEventId = '00000000-0000-4000-8000-000000000000';

interface ApiState {
  token: string;
}

function fakeApi(state: ApiState): typeof fetch {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(
      typeof input === 'string' || input instanceof URL ? input.toString() : input.url,
    );
    const headers = new Headers(init?.headers);
    if (url.pathname === '/internal/mcp/authorize') {
      return headers.get('x-causality-mcp-token') === state.token &&
        headers.get('x-causality-internal-mcp-secret') === internalSecret
        ? Response.json({
            authorized: true,
            userId: '10000000-0000-4000-8000-000000000001',
            username: 'wire-user',
            tokenId: '10000000-0000-4000-8000-000000000002',
          })
        : Response.json({ code: 'MCP_UNAUTHORIZED', message: 'invalid' }, { status: 401 });
    }
    if (url.pathname === '/internal/mcp/events') {
      return Response.json({
        items: [],
        page: 1,
        pageSize: 50,
        totalItems: 0,
        totalPages: 1,
        semanticIndexNotice: null,
      });
    }
    if (url.pathname.startsWith(`/internal/mcp/events/${missingEventId}`)) {
      return Response.json({ code: 'EVENT_NOT_FOUND', message: '原子事件不存在' }, { status: 404 });
    }
    return Response.json({ code: 'NOT_FOUND', message: 'not found' }, { status: 404 });
  }) as typeof fetch;
}

function endpoint(server: CausalityMcpHttpServer): string {
  const address = server.httpServer.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}/mcp`;
}

async function connect(endpointUrl: string, token: string, name: string) {
  const client = new Client({ name, version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(endpointUrl), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport as unknown as Parameters<Client['connect']>[0]);
  return {
    client,
    async close() {
      try {
        await transport.terminateSession();
      } finally {
        await client.close();
      }
    },
  };
}

describe('Streamable HTTP wire compatibility', () => {
  const servers: CausalityMcpHttpServer[] = [];
  const connections: Array<{ close(): Promise<void> }> = [];

  afterEach(async () => {
    await Promise.allSettled(connections.splice(0).map((connection) => connection.close()));
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  async function start(state: ApiState, logs: unknown[]) {
    const logger: McpTransportLogger = {
      info: (entry) => logs.push(entry),
      error: (entry) => logs.push(entry),
    };
    const server = await startCausalityMcpHttpServer({
      apiBaseUrl: 'http://wire-api.test',
      internalSecret,
      fetch: fakeApi(state),
      host: '127.0.0.1',
      port: 0,
      logger,
    });
    servers.push(server);
    return server;
  }

  it('negotiates, exposes exact catalogs, reads content, and returns stable Tool results', async () => {
    const logs: unknown[] = [];
    const server = await start({ token: validToken }, logs);
    const connection = await connect(endpoint(server), validToken, 'http-wire-client');
    connections.push(connection);

    const [tools, prompts, resources] = await Promise.all([
      connection.client.listTools(),
      connection.client.listPrompts(),
      connection.client.listResources(),
    ]);
    const prompt = await connection.client.getPrompt({ name: MCP_PROMPT_NAMES.analyzeEvent });
    const resource = await connection.client.readResource({ uri: MCP_RESOURCE_URIS.capabilities });
    const searched = await connection.client.callTool({
      name: MCP_TOOL_NAMES.searchAtomicEvents,
      arguments: { query: 'wire-probe-private', page: 1, searchMode: 'standard' },
    });
    const missing = await connection.client.callTool({
      name: MCP_TOOL_NAMES.getAtomicEvent,
      arguments: { eventId: missingEventId },
    });

    expect(tools.tools.map((item) => item.name)).toEqual(Object.values(MCP_TOOL_NAMES));
    expect(prompts.prompts.map((item) => item.name)).toEqual(Object.values(MCP_PROMPT_NAMES));
    expect(resources.resources.map((item) => item.uri)).toEqual(Object.values(MCP_RESOURCE_URIS));
    expect(prompt.messages).toHaveLength(1);
    expect(resource.contents).toHaveLength(1);
    expect(searched.isError).not.toBe(true);
    expect(searched).toMatchObject({ structuredContent: { totalItems: 0 } });
    expect(missing).toMatchObject({
      isError: true,
      structuredContent: {
        error: { code: 'EVENT_NOT_FOUND', category: 'not_found', retryable: false },
      },
    });
    const serializedLogs = JSON.stringify(logs);
    expect(serializedLogs).not.toContain(validToken);
    expect(serializedLogs).not.toContain('wire-probe-private');
    expect(serializedLogs).toContain('search_atomic_events');
  });

  it('isolates sessions and applies current authorization to new connections', async () => {
    const state = { token: validToken };
    const server = await start(state, []);
    const [first, second] = await Promise.all([
      connect(endpoint(server), validToken, 'first-client'),
      connect(endpoint(server), validToken, 'second-client'),
    ]);
    connections.push(first, second);
    await Promise.all([first.client.listTools(), second.client.listTools()]);
    await first.close();
    connections.splice(connections.indexOf(first), 1);
    await expect(second.client.listTools()).resolves.toMatchObject({ tools: expect.any(Array) });

    state.token = rotatedToken;
    await expect(second.client.listTools()).rejects.toThrow();
    const current = await connect(endpoint(server), rotatedToken, 'rotated-client');
    connections.push(current);
    await expect(current.client.listTools()).resolves.toMatchObject({ tools: expect.any(Array) });

    const unauthorized = await fetch(endpoint(server), {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(unauthorized.status).toBe(401);
  });
});
