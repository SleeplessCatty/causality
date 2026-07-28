import type {
  AiCaptureCandidateSet,
  AiCaptureComparison,
  McpSettingsResponse,
} from '@causality/contracts';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { connectCausalityMcpStdioServer } from '../src/transports/stdioServer.js';

const token = 'c'.repeat(64);
const settings: McpSettingsResponse = {
  serviceStatus: 'running',
  endpoint: 'http://127.0.0.1:8081/mcp',
  maskedToken: 'cccc…cccc',
  accessToken: token,
  tokenVersion: 1,
  updatedAt: '2026-07-28T12:00:00.000Z',
  clientConfig: {
    transport: 'streamable-http',
    url: 'http://127.0.0.1:8081/mcp',
    headers: { Authorization: `Bearer ${token}` },
  },
};
const candidates: AiCaptureCandidateSet = {
  topic: '空候选测试',
  clientName: 'stdio-test',
  atomicEvents: [],
  concreteCases: [],
  causalRelations: [],
  relationCaseLinks: [],
};
const comparison: AiCaptureComparison = {
  atomicEvents: [],
  concreteCases: [],
  causalRelations: [],
  relationCaseLinks: [],
};

function createApiFetch(calls: Array<{ path: string; token: string | null }>): typeof fetch {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(
      typeof input === 'string' || input instanceof URL ? input.toString() : input.url,
    );
    const requestToken = new Headers(init?.headers).get('x-causality-mcp-token');
    calls.push({ path: url.pathname, token: requestToken });
    if (url.pathname === '/api/mcp/settings') return Response.json(settings);
    if (url.pathname === '/api/ai-captures/compare') return Response.json(comparison);
    return Response.json({ code: 'NOT_FOUND', message: 'not found' }, { status: 404 });
  }) as typeof fetch;
}

describe('stdio MCP transport', () => {
  const clients: Client[] = [];
  const servers: Awaited<ReturnType<typeof connectCausalityMcpStdioServer>>[] = [];

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it('loads the current local credential and exposes the same tools and prompt', async () => {
    const calls: Array<{ path: string; token: string | null }> = [];
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = await connectCausalityMcpStdioServer({
      apiBaseUrl: 'http://127.0.0.1:3000',
      fetch: createApiFetch(calls),
      transport: serverTransport,
    });
    servers.push(server);
    const client = new Client({ name: 'stdio-test', version: '1.0.0' });
    clients.push(client);
    await client.connect(clientTransport);

    const [tools, prompts, compared] = await Promise.all([
      client.listTools(),
      client.listPrompts(),
      client.callTool({ name: 'compare_knowledge_candidates', arguments: candidates }),
    ]);

    expect(tools.tools).toHaveLength(11);
    expect(prompts.prompts.map((prompt) => prompt.name)).toEqual(['causality_capture']);
    expect(compared.structuredContent).toEqual(comparison);
    expect(calls).toEqual([
      { path: '/api/mcp/settings', token: null },
      { path: '/api/ai-captures/compare', token },
    ]);
  });

  it('rejects an invalid settings response before connecting the transport', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const invalidFetch = vi.fn<typeof fetch>(async () =>
      Response.json({ ...settings, accessToken: 'invalid' }),
    ) as typeof fetch;

    await expect(
      connectCausalityMcpStdioServer({
        apiBaseUrl: 'http://127.0.0.1:3000',
        fetch: invalidFetch,
        transport: serverTransport,
      }),
    ).rejects.toThrow('MCP settings response is invalid');
    await clientTransport.close();
    await serverTransport.close();
  });
});
