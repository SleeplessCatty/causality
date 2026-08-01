import {
  createMcpTokenResponseSchema,
  mcpTokenSummarySchema,
  revokeMcpTokenResponseSchema,
} from '@causality/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startPostgresTestContext } from './support/postgresTestContext.js';

describe.sequential('MCP personal access token HTTP API', () => {
  let context: Awaited<ReturnType<typeof startPostgresTestContext>>;

  beforeAll(async () => {
    context = await startPostgresTestContext('causality_mcp_access_test');
  }, 120_000);

  afterAll(async () => {
    await context.close();
  });

  it('creates a one-time personal token, lists its safe summary, and revokes it', async () => {
    const empty = await context.app.inject({ method: 'GET', url: '/api/mcp/tokens' });
    const created = await context.app.inject({
      method: 'POST',
      url: '/api/mcp/tokens',
      payload: { deviceName: '  Jason desktop  ' },
    });

    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual([]);
    expect(created.statusCode).toBe(201);
    const body = createMcpTokenResponseSchema.parse(created.json());
    expect(body.token).toMatch(/^cau_pat_[A-Za-z0-9_-]{43}$/);
    expect(body.summary.deviceName).toBe('Jason desktop');
    expect(body.summary.revokedAt).toBeNull();

    const listed = await context.app.inject({ method: 'GET', url: '/api/mcp/tokens' });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual([mcpTokenSummarySchema.parse(body.summary)]);
    expect(JSON.stringify(listed.json())).not.toContain(body.token);

    const revoked = await context.app.inject({
      method: 'DELETE',
      url: `/api/mcp/tokens/${body.summary.id}`,
    });
    expect(revoked.statusCode).toBe(200);
    expect(revokeMcpTokenResponseSchema.parse(revoked.json())).toEqual({ revoked: true });

    const afterRevoke = await context.app.inject({ method: 'GET', url: '/api/mcp/tokens' });
    expect(afterRevoke.json()).toHaveLength(1);
    expect(mcpTokenSummarySchema.parse(afterRevoke.json()[0]).revokedAt).not.toBeNull();
  });
});
