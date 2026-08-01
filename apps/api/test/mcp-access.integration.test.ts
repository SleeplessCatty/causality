import {
  createMcpTokenResponseSchema,
  mcpTokenSummarySchema,
  revokeMcpTokenResponseSchema,
} from '@causality/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startPostgresTestContext } from './support/postgresTestContext.js';
import { PostgresAuditWriter } from '../src/features/audit/auditRepository.js';
import { PostgresMcpAccessRepository } from '../src/features/mcp-access/mcpAccessRepository.js';
import { McpAccessService } from '../src/features/mcp-access/mcpAccessService.js';

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

  it('keeps token lists and revocation isolated between users', async () => {
    const passwordHash = 'isolation-test-password';
    const userB = await context.pool.query<{ id: string }>(
      `insert into users (username, password_hash, must_change_password)
       values ('mcp-isolated-user', $1, false) returning id`, [passwordHash],
    );
    const service = new McpAccessService(
      new PostgresMcpAccessRepository(context.pool), new PostgresAuditWriter(),
    );
    const actorA = { actorType: 'user' as const, userId: (await context.pool.query<{ id: string }>(`select id from users where username = 'integration-user'`)).rows[0]!.id, username: 'integration-user', channel: 'web' as const, requestId: 'a' };
    const actorB = { actorType: 'user' as const, userId: userB.rows[0]!.id, username: 'mcp-isolated-user', channel: 'web' as const, requestId: 'b' };
    const bToken = await service.create(actorB, 'Isolated B');
    expect((await service.list(actorA)).some((token) => token.id === bToken.summary.id)).toBe(false);
    await expect(service.revoke(actorA, bToken.summary.id)).rejects.toMatchObject({ code: 'TOKEN_NOT_FOUND' });
    expect(await service.authorize(bToken.token)).toMatchObject({ userId: actorB.userId });
    const firstUse = await context.anonymousInject({
      method: 'POST', url: '/internal/mcp/authorize', headers: {
        'x-causality-mcp-token': bToken.token,
        'x-causality-internal-mcp-secret': 'ef'.repeat(32),
        'x-causality-mcp-client-name': 'Desktop A',
      },
    });
    expect(firstUse.statusCode).toBe(200);
    await context.pool.query(
      `update mcp_access_tokens set last_used_at = clock_timestamp() - interval '1 minute'
       where id = $1`, [bToken.summary.id],
    );
    await context.anonymousInject({ method: 'POST', url: '/internal/mcp/authorize', headers: {
      'x-causality-mcp-token': bToken.token, 'x-causality-internal-mcp-secret': 'ef'.repeat(32),
      'x-causality-mcp-client-name': 'Desktop B',
    } });
    const throttled = await context.pool.query<{ last_client_name: string | null }>(
      `select last_client_name from mcp_access_tokens where id = $1`, [bToken.summary.id],
    );
    expect(throttled.rows[0]?.last_client_name).toBe('Desktop A');
    await context.pool.query(
      `update mcp_access_tokens set last_used_at = clock_timestamp() - interval '6 minutes'
       where id = $1`, [bToken.summary.id],
    );
    await context.anonymousInject({ method: 'POST', url: '/internal/mcp/authorize', headers: {
      'x-causality-mcp-token': bToken.token, 'x-causality-internal-mcp-secret': 'ef'.repeat(32),
      'x-causality-mcp-client-name': 'Desktop B',
    } });
    const refreshed = await context.pool.query<{ last_client_name: string | null }>(
      `select last_client_name from mcp_access_tokens where id = $1`, [bToken.summary.id],
    );
    expect(refreshed.rows[0]?.last_client_name).toBe('Desktop B');
  });
});
