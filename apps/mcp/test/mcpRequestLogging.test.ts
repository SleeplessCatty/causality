import { describe, expect, it } from 'vitest';

import {
  describeMcpMessage,
  markMcpRequestBusinessError,
  observeMcpRequest,
  type McpLogger,
} from '../src/observability/mcpRequestLogging.js';

describe('MCP request logging', () => {
  it('describes routing fields without retaining arguments', () => {
    expect(
      describeMcpMessage({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'search_atomic_events', arguments: { query: 'secret event text' } },
      }),
    ).toEqual({ method: 'tools/call', toolName: 'search_atomic_events' });
  });

  it('correlates start and completion without logging payloads or credentials', async () => {
    const entries: unknown[] = [];
    const logger: McpLogger = {
      info: (entry) => entries.push(entry),
      error: (entry) => entries.push(entry),
    };
    const token = 'Bearer ' + 'a'.repeat(64);

    await observeMcpRequest(
      {
        requestId: 'request-1',
        transport: 'streamable-http',
        method: 'tools/call',
        toolName: 'search_atomic_events',
        clientName: 'Codex',
        clientVersion: '1.2.3',
      },
      async () => {
        markMcpRequestBusinessError('EVENT_NOT_FOUND', false);
        return { authorization: token, query: 'secret event text' };
      },
      logger,
    );

    expect(entries).toEqual([
      expect.objectContaining({
        event: 'mcp_request_started',
        requestId: 'request-1',
        transport: 'streamable-http',
        method: 'tools/call',
        toolName: 'search_atomic_events',
        clientName: 'Codex',
        clientVersion: '1.2.3',
      }),
      expect.objectContaining({
        event: 'mcp_request_completed',
        requestId: 'request-1',
        outcome: 'business_error',
        errorCode: 'EVENT_NOT_FOUND',
        retryable: false,
        durationMs: expect.any(Number),
      }),
    ]);
    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain('secret event text');
  });

  it('records an unexpected exception as a system error without its cause', async () => {
    const entries: unknown[] = [];
    const logger: McpLogger = {
      info: (entry) => entries.push(entry),
      error: (entry) => entries.push(entry),
    };
    const secret = 'private-error-cause';

    await expect(
      observeMcpRequest(
        { requestId: 'request-2', transport: 'stdio', method: 'resources/read' },
        async () => {
          throw new Error('public failure', { cause: new Error(secret) });
        },
        logger,
      ),
    ).rejects.toThrow('public failure');

    expect(entries.at(-1)).toMatchObject({
      event: 'mcp_request_completed',
      requestId: 'request-2',
      outcome: 'system_error',
      errorCode: 'MCP_REQUEST_FAILURE',
    });
    expect(JSON.stringify(entries)).not.toContain(secret);
  });
});
