import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  startCausalityMcpHttpServer,
  type CausalityMcpHttpServer,
  type McpTransportLogger,
} from '../src/transports/httpServer.js';
import { buildInferOutcomesPrompt } from '../src/prompts/inferOutcomesPrompt.js';

const firstToken = `cau_pat_${'a'.repeat(43)}`;
const rotatedToken = `cau_pat_${'b'.repeat(43)}`;
const internalSecret = 'e'.repeat(64);
const requestBody = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'http-test', version: '1.0.0' },
  },
});

interface ApiState {
  token: string;
  authorizeCalls: string[];
  workflowTokens: string[];
  statusTokens: Array<string | null>;
}

function apiFetch(state: ApiState): typeof fetch {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(
      typeof input === 'string' || input instanceof URL ? input.toString() : input.url,
    );
    const headers = new Headers(init?.headers);
    if (url.pathname === '/internal/mcp/ai-captures/compare') {
      state.workflowTokens.push(headers.get('x-causality-mcp-token') ?? '');
      return Response.json({
        atomicEvents: [],
        concreteCases: [],
        causalRelations: [],
        relationCaseLinks: [],
      });
    }
    if (['/internal/mcp/health', '/internal/mcp/ready', '/internal/mcp/semantic/lifecycle'].includes(url.pathname)) {
      state.statusTokens.push(headers.get('x-causality-mcp-token'));
      if (url.pathname === '/internal/mcp/health') {
        return Response.json({ status: 'ok', service: 'causality-api' });
      }
      if (url.pathname === '/internal/mcp/ready') {
        return Response.json({ status: 'ready', database: 'available' });
      }
      return Response.json({
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
          checkedAt: '2026-07-30T12:00:00.000Z',
        },
        pollAfterMs: null,
        updatedAt: '2026-07-30T12:00:00.000Z',
      });
    }
    if (url.pathname !== '/internal/mcp/authorize') {
      return Response.json({ code: 'NOT_FOUND', message: 'not found' }, { status: 404 });
    }
    const token = headers.get('x-causality-mcp-token') ?? '';
    state.authorizeCalls.push(token);
    if (
      token !== state.token ||
      headers.get('x-causality-internal-mcp-secret') !== internalSecret
    ) {
      return Response.json({ code: 'MCP_UNAUTHORIZED', message: 'invalid' }, { status: 401 });
    }
    return Response.json({
      authorized: true,
      userId: '10000000-0000-4000-8000-000000000001',
      username: 'mcp-user',
      tokenId: '10000000-0000-4000-8000-000000000002',
    });
  }) as typeof fetch;
}

function baseUrl(server: CausalityMcpHttpServer): string {
  const address = server.httpServer.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function postMcp(
  server: CausalityMcpHttpServer,
  options: {
    token?: string;
    origin?: string;
    clientIp?: string;
    body?: string;
    sessionId?: string;
  } = {},
): Promise<Response> {
  const headers = new Headers({
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
  });
  if (options.token) headers.set('authorization', `Bearer ${options.token}`);
  if (options.origin) headers.set('origin', options.origin);
  if (options.clientIp) headers.set('x-causality-client-ip', options.clientIp);
  if (options.sessionId) headers.set('mcp-session-id', options.sessionId);
  return fetch(`${baseUrl(server)}/mcp`, {
    method: 'POST',
    headers,
    body: options.body ?? requestBody,
  });
}

async function deleteMcp(
  server: CausalityMcpHttpServer,
  token: string,
  sessionId: string,
): Promise<Response> {
  return fetch(`${baseUrl(server)}/mcp`, {
    method: 'DELETE',
    headers: {
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
      'mcp-session-id': sessionId,
    },
  });
}

describe('Streamable HTTP transport security', () => {
  const servers: CausalityMcpHttpServer[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  async function start(
    options: {
      state?: ApiState;
      allowedOrigins?: string[];
      maxBodyBytes?: number;
      logger?: McpTransportLogger;
      trustedProxyAddresses?: string[];
    } = {},
  ) {
    const state = options.state ?? {
      token: firstToken,
      authorizeCalls: [],
      workflowTokens: [],
      statusTokens: [],
    };
    const server = await startCausalityMcpHttpServer({
      apiBaseUrl: 'http://causality-api.test',
      internalSecret,
      fetch: apiFetch(state),
      host: '127.0.0.1',
      port: 0,
      allowedOrigins: options.allowedOrigins ?? ['http://127.0.0.1:5173'],
      ...(options.maxBodyBytes === undefined ? {} : { maxBodyBytes: options.maxBodyBytes }),
      ...(options.logger === undefined ? {} : { logger: options.logger }),
      ...(options.trustedProxyAddresses === undefined
        ? {}
        : { trustedProxyAddresses: options.trustedProxyAddresses }),
    });
    servers.push(server);
    return { server, state };
  }

  it('rejects a missing or invalid Bearer token with 401', async () => {
    const { server, state } = await start();

    const missing = await postMcp(server);
    const malformed = await fetch(`${baseUrl(server)}/mcp`, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        authorization: 'Basic credentials',
        'content-type': 'application/json',
      },
      body: requestBody,
    });
    const invalid = await postMcp(server, { token: rotatedToken });

    expect([missing.status, malformed.status, invalid.status]).toEqual([401, 401, 401]);
    expect(state.authorizeCalls).toEqual([rotatedToken]);
  });

  it('trusts a controlled proxy client IP and limits a source before authorization', async () => {
    const { server, state } = await start({ trustedProxyAddresses: ['127.0.0.1', '::1'] });
    const responses = await Promise.all(
      Array.from({ length: 121 }, (_, index) =>
        postMcp(server, {
          token: `cau_pat_${String(index).padStart(43, 'z')}`,
          clientIp: '203.0.113.44',
        }),
      ),
    );

    expect(responses.filter((response) => response.status === 429)).toHaveLength(1);
    expect(state.authorizeCalls).toHaveLength(120);
  });

  it('rejects an untrusted browser Origin with 403 before authorization', async () => {
    const { server, state } = await start();

    const response = await postMcp(server, {
      token: firstToken,
      origin: 'https://untrusted.example',
    });

    expect(response.status).toBe(403);
    expect(state.authorizeCalls).toEqual([]);
  });

  it('does not implement OAuth discovery', async () => {
    const { server } = await start();
    const response = await fetch(`${baseUrl(server)}/.well-known/oauth-authorization-server`);
    expect(response.status).toBe(404);
  });

  it('allows a configured local Origin or an absent non-browser Origin to initialize', async () => {
    const { server } = await start();

    const browser = await postMcp(server, {
      token: firstToken,
      origin: 'http://127.0.0.1:5173',
    });
    const nonBrowser = await postMcp(server, { token: firstToken });

    expect(browser.status).toBe(200);
    expect(nonBrowser.status).toBe(200);
    expect(browser.headers.get('mcp-session-id')).toBeTruthy();
    expect(nonBrowser.headers.get('mcp-session-id')).toBeTruthy();
  });

  it('rejects a request body above the configured limit with 413', async () => {
    const { server, state } = await start({ maxBodyBytes: 128 });

    const response = await postMcp(server, {
      token: firstToken,
      body: JSON.stringify({ oversized: 'x'.repeat(1_000) }),
    });

    expect(response.status).toBe(413);
    expect(state.authorizeCalls).toEqual([]);
  });

  it('does not write a token or request body into logs', async () => {
    const entries: unknown[] = [];
    const logger: McpTransportLogger = {
      info: (...values) => entries.push(...values),
      error: (...values) => entries.push(...values),
    };
    const { server } = await start({ logger });
    const secretBody = JSON.stringify({ secret: 'private-conversation-body' });

    await postMcp(server, { token: firstToken, body: secretBody });

    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain(firstToken);
    expect(serialized).not.toContain('private-conversation-body');
  });

  it('correlates payload-free start and completion logs for an initialized client', async () => {
    const entries: unknown[] = [];
    const logger: McpTransportLogger = {
      info: (...values) => entries.push(...values),
      error: (...values) => entries.push(...values),
    };
    const { server } = await start({ logger });
    const initialized = await postMcp(server, { token: firstToken });
    const sessionId = initialized.headers.get('mcp-session-id')!;
    await postMcp(server, {
      token: firstToken,
      sessionId,
      body: JSON.stringify({ jsonrpc: '2.0', id: 8, method: 'tools/list' }),
    });

    const starts = entries.filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === 'object' &&
        entry !== null &&
        'event' in entry &&
        entry.event === 'mcp_request_started',
    );
    const completions = entries.filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === 'object' &&
        entry !== null &&
        'event' in entry &&
        entry.event === 'mcp_request_completed',
    );
    const listStart = starts.find((entry) => entry.method === 'tools/list');
    const listCompletion = completions.find((entry) => entry.requestId === listStart?.requestId);

    expect(listStart).toMatchObject({
      transport: 'streamable-http',
      clientName: 'http-test',
      clientVersion: '1.0.0',
    });
    expect(listCompletion).toMatchObject({ outcome: 'success', durationMs: expect.any(Number) });
    expect(JSON.stringify(entries)).not.toContain(firstToken);
  });

  it('re-authorizes every request so rotation invalidates an existing session immediately', async () => {
    const state: ApiState = {
      token: firstToken,
      authorizeCalls: [],
      workflowTokens: [],
      statusTokens: [],
    };
    const { server } = await start({ state });
    const initialized = await postMcp(server, { token: firstToken });
    const sessionId = initialized.headers.get('mcp-session-id')!;
    state.token = rotatedToken;
    const listBody = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' });

    const stale = await postMcp(server, { token: firstToken, sessionId, body: listBody });
    const current = await postMcp(server, { token: rotatedToken, sessionId, body: listBody });
    const newSession = await postMcp(server, { token: rotatedToken });

    expect(stale.status).toBe(401);
    expect(current.status).toBe(200);
    expect(newSession.status).toBe(200);
    expect(newSession.headers.get('mcp-session-id')).toBeTruthy();
    expect(state.authorizeCalls).toEqual([firstToken, firstToken, rotatedToken, rotatedToken]);
  });

  it('isolates concurrent sessions, invalid sessions, and explicit session cleanup', async () => {
    const { server } = await start();
    const [first, second] = await Promise.all([
      postMcp(server, { token: firstToken }),
      postMcp(server, { token: firstToken }),
    ]);
    const firstSessionId = first.headers.get('mcp-session-id')!;
    const secondSessionId = second.headers.get('mcp-session-id')!;
    const listBody = JSON.stringify({ jsonrpc: '2.0', id: 20, method: 'tools/list' });

    const [firstList, secondList, invalid] = await Promise.all([
      postMcp(server, { token: firstToken, sessionId: firstSessionId, body: listBody }),
      postMcp(server, { token: firstToken, sessionId: secondSessionId, body: listBody }),
      postMcp(server, { token: firstToken, sessionId: 'invalid-session', body: listBody }),
    ]);
    expect([firstList.status, secondList.status, invalid.status]).toEqual([200, 200, 404]);

    const secondStillWorks = await postMcp(server, {
      token: firstToken,
      sessionId: secondSessionId,
      body: listBody,
    });
    expect(secondStillWorks.status).toBe(200);

    const closed = await deleteMcp(server, firstToken, firstSessionId);
    expect(closed.status).toBe(200);
    const closedSession = await postMcp(server, {
      token: firstToken,
      sessionId: firstSessionId,
      body: listBody,
    });
    const survivingSession = await postMcp(server, {
      token: firstToken,
      sessionId: secondSessionId,
      body: listBody,
    });
    expect(closedSession.status).toBe(404);
    expect(survivingSession.status).toBe(200);
  });

  it('binds protected tool calls to the token from the current authorized request', async () => {
    const { server, state } = await start();
    const initialized = await postMcp(server, { token: firstToken });
    const sessionId = initialized.headers.get('mcp-session-id')!;
    const callBody = JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'compare_knowledge_candidates',
        arguments: {
          topic: 'HTTP 请求上下文',
          clientName: 'http-test',
          atomicEvents: [],
          concreteCases: [],
          causalRelations: [],
          relationCaseLinks: [],
        },
      },
    });

    const response = await postMcp(server, {
      token: firstToken,
      sessionId,
      body: callBody,
    });
    const payload = (await response.json()) as {
      result?: { structuredContent?: { atomicEvents?: unknown[] } };
    };

    expect(response.status).toBe(200);
    expect(payload.result?.structuredContent?.atomicEvents).toEqual([]);
    expect(state.workflowTokens).toEqual([firstToken]);
  });

  it('lists and reads live resources inside the current authorized request context', async () => {
    const { server, state } = await start();
    const initialized = await postMcp(server, { token: firstToken });
    const sessionId = initialized.headers.get('mcp-session-id')!;
    const listed = await postMcp(server, {
      token: firstToken,
      sessionId,
      body: JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'resources/list' }),
    });
    const read = await postMcp(server, {
      token: firstToken,
      sessionId,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 5,
        method: 'resources/read',
        params: { uri: 'causality://system/status' },
      }),
    });
    const listedBody = (await listed.json()) as {
      result: { resources: Array<{ uri: string }> };
    };
    const readBody = (await read.json()) as {
      result: { contents: Array<{ text: string }> };
    };
    const status = JSON.parse(readBody.result.contents[0]!.text) as {
      overallStatus: string;
      database: { status: string };
    };

    expect(listed.status).toBe(200);
    expect(read.status).toBe(200);
    expect(listedBody.result.resources.map((resource) => resource.uri)).toEqual([
      'causality://rules/domain-model',
      'causality://rules/capture',
      'causality://capabilities',
      'causality://system/status',
    ]);
    expect(status).toMatchObject({ overallStatus: 'degraded', database: { status: 'ready' } });
    expect(state.statusTokens).toEqual([firstToken, firstToken, firstToken]);
  });

  it('lists and reads the outcome inference prompt inside an authorized session', async () => {
    const { server } = await start();
    const initialized = await postMcp(server, { token: firstToken });
    const sessionId = initialized.headers.get('mcp-session-id')!;
    const listed = await postMcp(server, {
      token: firstToken,
      sessionId,
      body: JSON.stringify({ jsonrpc: '2.0', id: 6, method: 'prompts/list' }),
    });
    const read = await postMcp(server, {
      token: firstToken,
      sessionId,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 7,
        method: 'prompts/get',
        params: { name: 'causality_infer_outcomes' },
      }),
    });
    const listedBody = (await listed.json()) as {
      result: { prompts: Array<{ name: string }> };
    };
    const readBody = (await read.json()) as {
      result: { messages: Array<{ content: { text: string } }> };
    };

    expect(listed.status).toBe(200);
    expect(read.status).toBe(200);
    expect(listedBody.result.prompts.map((prompt) => prompt.name)).toContain(
      'causality_infer_outcomes',
    );
    expect(readBody.result.messages[0]?.content.text).toBe(buildInferOutcomesPrompt());
  });

  it('exposes a minimal unauthenticated health response', async () => {
    const { server, state } = await start();

    const response = await fetch(`${baseUrl(server)}/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    expect(state.authorizeCalls).toEqual([]);
  });
});
