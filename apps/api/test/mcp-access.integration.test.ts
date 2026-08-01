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
import { startCausalityMcpHttpServer } from '../../mcp/src/transports/httpServer.js';

async function sendMcpRequest(
  endpoint: string,
  token: string,
  body: object,
  sessionId?: string,
): Promise<Response> {
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify(body),
  });
}

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
    const columns = await context.pool.query<{ column_name: string }>(
      `select column_name
       from information_schema.columns
       where table_schema = 'public' and table_name = 'mcp_access_tokens'
       order by ordinal_position`,
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      'id',
      'user_id',
      'token_digest',
      'device_name',
      'created_at',
      'last_used_at',
      'last_client_name',
      'revoked_at',
    ]);
    await expect(
      context.pool.query(
        `insert into mcp_access_tokens (user_id, token_digest, device_name)
         values ((select id from users where username = 'integration-user'), $1, 'Duplicate digest')`,
        [stored.rows[0]!.token_digest],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    const authorized = await context.anonymousInject({
      method: 'POST',
      url: '/internal/mcp/authorize',
      headers: {
        'x-causality-mcp-token': body.token,
        'x-causality-internal-mcp-secret': 'ef'.repeat(32),
      },
    });
    expect(authorized.statusCode).toBe(200);
    expect(authorized.json()).toMatchObject({
      authorized: true,
      tokenId: body.summary.id,
      username: 'integration-user',
    });

    const listed = await context.app.inject({ method: 'GET', url: '/api/mcp/tokens' });
    expect(listed.statusCode).toBe(200);
    const listedTokens = mcpTokenSummarySchema.array().parse(listed.json());
    expect(listedTokens).toEqual([
      {
        ...body.summary,
        lastUsedAt: expect.any(String),
      },
    ]);
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
      method: 'POST',
      url: '/internal/mcp/authorize',
      headers: {
        'x-causality-mcp-token': body.token,
        'x-causality-internal-mcp-secret': 'ef'.repeat(32),
      },
    });
    expect(internal.statusCode).toBe(401);
  });

  it('enforces the active-token limit under concurrent creates and rejects untrimmed writes', async () => {
    const created = await Promise.all(
      Array.from({ length: 11 }, (_, index) =>
        context.app.inject({
          method: 'POST',
          url: '/api/mcp/tokens',
          payload: { deviceName: `Client ${index}` },
        }),
      ),
    );
    expect(
      created.map((response) => response.statusCode).sort((left, right) => left - right),
    ).toEqual([...Array.from({ length: 10 }, () => 201), 409]);
    expect(created.find((response) => response.statusCode === 409)?.json()).toEqual({
      code: 'TOKEN_LIMIT_REACHED',
      message: '最多保留 10 个有效 MCP 令牌',
    });
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
       values ('mcp-isolated-user', $1, false) returning id`,
      [passwordHash],
    );
    const service = new McpAccessService(
      new PostgresMcpAccessRepository(context.pool),
      new PostgresAuditWriter(),
    );
    const actorA = {
      actorType: 'user' as const,
      userId: (
        await context.pool.query<{ id: string }>(
          `select id from users where username = 'integration-user'`,
        )
      ).rows[0]!.id,
      username: 'integration-user',
      channel: 'web' as const,
      requestId: 'a',
    };
    const actorB = {
      actorType: 'user' as const,
      userId: userB.rows[0]!.id,
      username: 'mcp-isolated-user',
      channel: 'web' as const,
      requestId: 'b',
    };
    const bToken = await service.create(actorB, 'Isolated B');
    expect((await service.list(actorA)).some((token) => token.id === bToken.summary.id)).toBe(
      false,
    );
    await expect(service.revoke(actorA, bToken.summary.id)).rejects.toMatchObject({
      code: 'TOKEN_NOT_FOUND',
    });
    expect(await service.authorize(bToken.token, 'Desktop A')).toMatchObject({
      userId: actorB.userId,
    });
    const firstUse = await context.anonymousInject({
      method: 'POST',
      url: '/internal/mcp/authorize',
      headers: {
        'x-causality-mcp-token': bToken.token,
        'x-causality-internal-mcp-secret': 'ef'.repeat(32),
        'x-causality-mcp-client-name': 'Desktop A',
      },
    });
    expect(firstUse.statusCode).toBe(200);
    await context.pool.query(
      `update mcp_access_tokens set last_used_at = clock_timestamp() - interval '1 minute'
       where id = $1`,
      [bToken.summary.id],
    );
    await context.anonymousInject({
      method: 'POST',
      url: '/internal/mcp/authorize',
      headers: {
        'x-causality-mcp-token': bToken.token,
        'x-causality-internal-mcp-secret': 'ef'.repeat(32),
        'x-causality-mcp-client-name': 'Desktop B',
      },
    });
    const throttled = await context.pool.query<{ last_client_name: string | null }>(
      `select last_client_name from mcp_access_tokens where id = $1`,
      [bToken.summary.id],
    );
    expect(throttled.rows[0]?.last_client_name).toBe('Desktop A');
    await context.pool.query(
      `update mcp_access_tokens set last_used_at = clock_timestamp() - interval '6 minutes'
       where id = $1`,
      [bToken.summary.id],
    );
    await context.anonymousInject({
      method: 'POST',
      url: '/internal/mcp/authorize',
      headers: {
        'x-causality-mcp-token': bToken.token,
        'x-causality-internal-mcp-secret': 'ef'.repeat(32),
        'x-causality-mcp-client-name': 'Desktop B',
      },
    });
    const refreshed = await context.pool.query<{ last_client_name: string | null }>(
      `select last_client_name from mcp_access_tokens where id = $1`,
      [bToken.summary.id],
    );
    expect(refreshed.rows[0]?.last_client_name).toBe('Desktop B');

    await context.pool.query(`update users set enabled = false where id = $1`, [actorB.userId]);
    expect(await service.authorize(bToken.token)).toBeNull();
    const stillActive = await context.pool.query<{ revoked_at: Date | null }>(
      `select revoked_at from mcp_access_tokens where id = $1`,
      [bToken.summary.id],
    );
    expect(stillActive.rows[0]?.revoked_at).toBeNull();
    await context.pool.query(`update users set enabled = true where id = $1`, [actorB.userId]);
    expect(await service.authorize(bToken.token)).toMatchObject({ userId: actorB.userId });
  });

  it('negotiates the MCP catalogs with a personal token created in PostgreSQL', async () => {
    const user = await context.pool.query<{ id: string }>(
      `insert into users (username, password_hash, must_change_password)
       values ('mcp-wire-user', 'wire-test-password', false)
       returning id`,
    );
    const service = new McpAccessService(
      new PostgresMcpAccessRepository(context.pool),
      new PostgresAuditWriter(),
    );
    const created = await service.create(
      {
        actorType: 'user',
        userId: user.rows[0]!.id,
        username: 'mcp-wire-user',
        channel: 'web',
        requestId: 'wire-create',
      },
      'Wire compatibility',
    );

    await context.app.listen({ host: '127.0.0.1', port: 0 });
    const apiAddress = context.app.server.address() as AddressInfo;
    const mcpServer = await startCausalityMcpHttpServer({
      apiBaseUrl: `http://127.0.0.1:${apiAddress.port}`,
      internalSecret: 'ef'.repeat(32),
      host: '127.0.0.1',
      port: 0,
      logger: { info() {}, error() {} },
    });
    try {
      const mcpAddress = mcpServer.httpServer.address() as AddressInfo;
      const endpoint = `http://127.0.0.1:${mcpAddress.port}/mcp`;
      const initialized = await sendMcpRequest(endpoint, created.token, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'postgres-wire-test', version: '1.0.0' },
        },
      });
      expect(initialized.status).toBe(200);
      const sessionId = initialized.headers.get('mcp-session-id');
      expect(sessionId).toBeTruthy();

      for (const [id, method, expectedLength] of [
        [2, 'tools/list', 15],
        [3, 'prompts/list', 5],
        [4, 'resources/list', 4],
      ] as const) {
        const response = await sendMcpRequest(
          endpoint,
          created.token,
          { jsonrpc: '2.0', id, method },
          sessionId!,
        );
        expect(response.status).toBe(200);
        const payload = (await response.json()) as {
          result?: { tools?: unknown[]; prompts?: unknown[]; resources?: unknown[] };
        };
        const catalog =
          payload.result?.tools ?? payload.result?.prompts ?? payload.result?.resources;
        expect(catalog).toHaveLength(expectedLength);
      }
    } finally {
      await mcpServer.close();
    }
  });
});
import type { AddressInfo } from 'node:net';
