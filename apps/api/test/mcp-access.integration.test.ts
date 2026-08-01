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
    const stored = await context.pool.query<{ token_digest: Buffer; device_name: string }>(
      `select token_digest, device_name from mcp_access_tokens where id = $1`,
      [body.summary.id],
    );
    expect(stored.rows[0]?.token_digest).toHaveLength(32);
    expect(JSON.stringify(stored.rows[0])).not.toContain(body.token);
    const authorized = await context.anonymousInject({
      method: 'POST', url: '/internal/mcp/authorize', headers: {
        'x-causality-mcp-token': body.token,
        'x-causality-internal-mcp-secret': 'ef'.repeat(32),
      },
    });
    expect(authorized.statusCode).toBe(200);
    expect(authorized.json()).toMatchObject({ authorized: true, tokenId: body.summary.id, username: 'integration-user' });

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
    const internal = await context.anonymousInject({
      method: 'POST', url: '/internal/mcp/authorize', headers: {
        'x-causality-mcp-token': body.token,
        'x-causality-internal-mcp-secret': 'ef'.repeat(32),
      },
    });
    expect(internal.statusCode).toBe(401);
  });

  it('enforces the active-token limit under concurrent creates and rejects untrimmed writes', async () => {
    const created = await Promise.all(
      Array.from({ length: 11 }, (_, index) =>
        context.app.inject({ method: 'POST', url: '/api/mcp/tokens', payload: { deviceName: `Client ${index}` } }),
      ),
    );
    expect(created.filter((response) => response.statusCode === 201)).toHaveLength(10);
    expect(created.filter((response) => response.statusCode === 409)).toHaveLength(1);
    const active = await context.pool.query<{ count: string }>(
      `select count(*) from mcp_access_tokens where user_id = (select id from users where username = 'integration-user') and revoked_at is null`,
    );
    expect(active.rows[0]?.count).toBe('10');
    await expect(
      context.pool.query(
        `insert into mcp_access_tokens (user_id, token_digest, device_name)
         values ((select id from users where username = 'integration-user'), decode(repeat('ab', 32), 'hex'), '  not trimmed  ')`,
      ),
    ).rejects.toThrow();
  });
});
