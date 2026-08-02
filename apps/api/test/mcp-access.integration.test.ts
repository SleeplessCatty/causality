import { spawn } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

import {
  createMcpTokenResponseSchema,
  deleteMcpTokenResponseSchema,
  mcpTokenSecretResponseSchema,
  mcpTokenSummarySchema,
} from '@causality/contracts';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startPostgresTestContext } from './support/postgresTestContext.js';
import { PostgresAuditWriter } from '../src/features/audit/auditRepository.js';
import { PostgresMcpAccessRepository } from '../src/features/mcp-access/mcpAccessRepository.js';
import { McpAccessService } from '../src/features/mcp-access/mcpAccessService.js';
import { createAesGcmMcpTokenCipher } from '../src/features/mcp-access/mcpTokenCipher.js';
import { startCausalityMcpHttpServer } from '../../mcp/src/transports/httpServer.js';

const tokenEncryptionKey = Buffer.alloc(32, 0x74).toString('base64');

function createAccessService(pool: Pool) {
  return new McpAccessService(
    new PostgresMcpAccessRepository(pool),
    new PostgresAuditWriter(),
    createAesGcmMcpTokenCipher(tokenEncryptionKey),
  );
}

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

async function queryStdioCatalogs(apiBaseUrl: string, token: string) {
  const mcpRoot = fileURLToPath(new URL('../../mcp/', import.meta.url));
  const tsxCli = fileURLToPath(new URL('../../mcp/node_modules/tsx/dist/cli.mjs', import.meta.url));
  const stdioEntry = fileURLToPath(new URL('../../mcp/src/stdio.ts', import.meta.url));
  const child = spawn(process.execPath, [tsxCli, stdioEntry], {
    cwd: mcpRoot,
    env: {
      ...process.env,
      CAUSALITY_API_URL: apiBaseUrl,
      CAUSALITY_MCP_TOKEN: token,
      CAUSALITY_INTERNAL_MCP_SECRET: 'ef'.repeat(32),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let nextId = 1;
  let stdoutBuffer = '';
  const stderr: string[] = [];
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
    },
  );
  child.stderr.on('data', (chunk) => stderr.push(String(chunk)));
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += String(chunk);
    while (stdoutBuffer.includes('\n')) {
      const newline = stdoutBuffer.indexOf('\n');
      const line = stdoutBuffer.slice(0, newline).trim();
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line) as { id?: number; result?: unknown; error?: unknown };
      if (typeof message.id !== 'number') continue;
      const pendingRequest = pending.get(message.id);
      if (!pendingRequest) continue;
      pending.delete(message.id);
      if (message.error) pendingRequest.reject(new Error(JSON.stringify(message.error)));
      else pendingRequest.resolve(message.result);
    }
  });
  child.once('exit', (code) => {
    for (const pendingRequest of pending.values()) {
      pendingRequest.reject(new Error(`stdio MCP exited before responding (${String(code)})`));
    }
    pending.clear();
  });

  const request = (method: string, params: object = {}) => {
    const id = nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`stdio MCP request timed out: ${method}`));
      }, 15_000);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  };

  let result:
    | {
        counts: { tools: number; prompts: number; resources: number };
        toolResult: unknown;
        stderr: string[];
      }
    | undefined;
  let exitFailure: Error | undefined;
  try {
    await request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'postgres-stdio-test', version: '1.0.0' },
    });
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`,
    );
    const [tools, prompts, resources] = (await Promise.all([
      request('tools/list'),
      request('prompts/list'),
      request('resources/list'),
    ])) as [{ tools: unknown[] }, { prompts: unknown[] }, { resources: unknown[] }];
    const toolResult = await request('tools/call', {
      name: 'search_atomic_events',
      arguments: { query: 'stdio-real-pat-probe', page: 1, searchMode: 'standard' },
    });
    result = {
      counts: {
        tools: tools.tools.length,
        prompts: prompts.prompts.length,
        resources: resources.resources.length,
      },
      toolResult,
      stderr,
    };
  } finally {
    child.stdin.end();
    let ended = await Promise.race([
      exited.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 5_000)),
    ]);
    if (!ended) {
      child.kill('SIGTERM');
      ended = await Promise.race([
        exited.then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 2_000)),
      ]);
    }
    if (!ended) {
      child.kill('SIGKILL');
    }
    const exit = await exited;
    if (exit.code !== 0 && exit.signal === null) {
      exitFailure = new Error(`stdio MCP exited with code ${String(exit.code)}`);
    }
  }
  if (exitFailure) throw exitFailure;
  return result!;
}

describe.sequential('MCP personal access token HTTP API', () => {
  let context: Awaited<ReturnType<typeof startPostgresTestContext>>;

  beforeAll(async () => {
    context = await startPostgresTestContext('causality_mcp_access_test');
  }, 120_000);

  afterAll(async () => {
    await context.close();
  });

  it('creates an encrypted personal token, recovers it on demand, and hard-deletes it', async () => {
    const empty = await context.app.inject({ method: 'GET', url: '/api/mcp/tokens' });
    const created = await context.app.inject({
      method: 'POST',
      url: '/api/mcp/tokens',
      payload: { name: '  Jason desktop  ' },
    });

    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual([]);
    expect(created.statusCode).toBe(201);
    const body = createMcpTokenResponseSchema.parse(created.json());
    expect(body.summary.name).toBe('Jason desktop');
    expect(body.summary.maskedToken).toMatch(/^cau_pat_[A-Za-z0-9_-]{4}••••[A-Za-z0-9_-]{4}$/u);
    const stored = await context.pool.query<{
      name: string;
      token_ciphertext: Buffer;
      token_digest: Buffer;
    }>(`select token_digest, name, token_ciphertext from mcp_access_tokens where id = $1`, [
      body.summary.id,
    ]);
    expect(stored.rows[0]?.token_digest).toHaveLength(32);
    expect(stored.rows[0]?.token_ciphertext.length).toBeGreaterThan(0);
    expect(stored.rows[0]?.name).toBe('Jason desktop');

    const secret = await context.app.inject({
      method: 'GET',
      url: `/api/mcp/tokens/${body.summary.id}/secret`,
    });
    expect(secret.statusCode).toBe(200);
    expect(secret.headers['cache-control']).toBe('no-store');
    const recovered = mcpTokenSecretResponseSchema.parse(secret.json());
    const authorized = await context.anonymousInject({
      method: 'POST',
      url: '/internal/mcp/authorize',
      headers: {
        'x-causality-mcp-token': recovered.token,
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
    expect(JSON.stringify(listed.json())).not.toContain(recovered.token);

    const deleted = await context.app.inject({
      method: 'DELETE',
      url: `/api/mcp/tokens/${body.summary.id}`,
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleteMcpTokenResponseSchema.parse(deleted.json())).toEqual({ deleted: true });

    const afterDelete = await context.app.inject({ method: 'GET', url: '/api/mcp/tokens' });
    expect(afterDelete.json()).toEqual([]);
    const internal = await context.anonymousInject({
      method: 'POST',
      url: '/internal/mcp/authorize',
      headers: {
        'x-causality-mcp-token': recovered.token,
        'x-causality-internal-mcp-secret': 'ef'.repeat(32),
      },
    });
    expect(internal.statusCode).toBe(401);
  });

  it('enforces the token limit, normalized-name uniqueness, and trimmed writes', async () => {
    const initial = await context.app.inject({
      method: 'POST',
      url: '/api/mcp/tokens',
      payload: { name: 'Client 0' },
    });
    expect(initial.statusCode).toBe(201);
    const duplicate = await context.app.inject({
      method: 'POST',
      url: '/api/mcp/tokens',
      payload: { name: ' client 0 ' },
    });
    expect(duplicate.statusCode, duplicate.body).toBe(409);
    expect(duplicate.json()).toEqual({ code: 'TOKEN_NAME_EXISTS', message: '令牌名称已存在' });

    const created = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        context.app.inject({
          method: 'POST',
          url: '/api/mcp/tokens',
          payload: { name: `Client ${index + 1}` },
        }),
      ),
    );
    expect(
      created.map((response) => response.statusCode).sort((left, right) => left - right),
    ).toEqual([...Array.from({ length: 9 }, () => 201), 409]);
    expect(created.find((response) => response.statusCode === 409)?.json()).toEqual({
      code: 'TOKEN_LIMIT_REACHED',
      message: '最多保留 10 个 MCP 令牌',
    });
    const storedCount = await context.pool.query<{ count: string }>(
      `select count(*) from mcp_access_tokens where user_id = (select id from users where username = 'integration-user')`,
    );
    expect(storedCount.rows[0]?.count).toBe('10');
    await expect(
      context.pool.query(
        `insert into mcp_access_tokens (
           user_id, token_digest, name, masked_token, token_ciphertext, token_iv, token_auth_tag
         ) values (
           (select id from users where username = 'integration-user'),
           decode(repeat('ab', 32), 'hex'), '  not trimmed  ', 'cau_pat_abcd••••wxyz',
           decode('01', 'hex'), decode(repeat('02', 12), 'hex'), decode(repeat('03', 16), 'hex')
         )`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('keeps token lists, secrets, and deletion isolated between users', async () => {
    const passwordHash = 'isolation-test-password';
    const userB = await context.pool.query<{ id: string }>(
      `insert into users (username, password_hash, must_change_password)
       values ('mcp-isolated-user', $1, false) returning id`,
      [passwordHash],
    );
    const service = createAccessService(context.pool);
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
    const bSecret = (await service.getSecret(actorB, bToken.summary.id)).token;
    expect((await service.list(actorA)).some((token) => token.id === bToken.summary.id)).toBe(
      false,
    );
    await expect(service.getSecret(actorA, bToken.summary.id)).rejects.toMatchObject({
      code: 'TOKEN_NOT_FOUND',
    });
    await expect(service.delete(actorA, bToken.summary.id)).rejects.toMatchObject({
      code: 'TOKEN_NOT_FOUND',
    });
    const foreignSecret = await context.app.inject({
      method: 'GET',
      url: `/api/mcp/tokens/${bToken.summary.id}/secret`,
    });
    expect(foreignSecret.statusCode).toBe(404);
    const foreignDelete = await context.app.inject({
      method: 'DELETE',
      url: `/api/mcp/tokens/${bToken.summary.id}`,
    });
    expect(foreignDelete.statusCode).toBe(404);
    expect(await service.authorize(bSecret, 'Desktop A')).toMatchObject({
      userId: actorB.userId,
    });
    const firstUse = await context.anonymousInject({
      method: 'POST',
      url: '/internal/mcp/authorize',
      headers: {
        'x-causality-mcp-token': bSecret,
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
        'x-causality-mcp-token': bSecret,
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
        'x-causality-mcp-token': bSecret,
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
    expect(await service.authorize(bSecret)).toBeNull();
    const stillStored = await context.pool.query<{ count: number }>(
      `select count(*)::int as count from mcp_access_tokens where id = $1`,
      [bToken.summary.id],
    );
    expect(stillStored.rows[0]?.count).toBe(1);
    await context.pool.query(`update users set enabled = true where id = $1`, [actorB.userId]);
    expect(await service.authorize(bSecret)).toMatchObject({ userId: actorB.userId });
  });

  it('negotiates the MCP catalogs with a personal token created in PostgreSQL', async () => {
    const user = await context.pool.query<{ id: string }>(
      `insert into users (username, password_hash, must_change_password)
       values ('mcp-wire-user', 'wire-test-password', false)
       returning id`,
    );
    const service = createAccessService(context.pool);
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
    const secret = (
      await service.getSecret(
        {
          actorType: 'user',
          userId: user.rows[0]!.id,
          username: 'mcp-wire-user',
          channel: 'web',
          requestId: 'wire-secret',
        },
        created.summary.id,
      )
    ).token;

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
      const initialized = await sendMcpRequest(endpoint, secret, {
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
          secret,
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

  it('negotiates stdio catalogs with a personal token created in PostgreSQL', async () => {
    const user = await context.pool.query<{ id: string }>(
      `insert into users (username, password_hash, must_change_password)
       values ('mcp-stdio-user', 'stdio-test-password', false)
       returning id`,
    );
    const service = createAccessService(context.pool);
    const actor = {
      actorType: 'user' as const,
      userId: user.rows[0]!.id,
      username: 'mcp-stdio-user',
      channel: 'web' as const,
      requestId: 'stdio-create',
    };
    const created = await service.create(actor, 'Stdio compatibility');
    const secret = (await service.getSecret(actor, created.summary.id)).token;
    if (!context.app.server.listening) {
      await context.app.listen({ host: '127.0.0.1', port: 0 });
    }
    const apiAddress = context.app.server.address() as AddressInfo;
    const result = await queryStdioCatalogs(`http://127.0.0.1:${apiAddress.port}`, secret);
    expect(result.counts).toEqual({ tools: 15, prompts: 5, resources: 4 });
    expect(result.toolResult).not.toMatchObject({ isError: true });
    expect(result.stderr.join('')).not.toContain(secret);

    await service.delete(actor, created.summary.id);
    const deleted = await queryStdioCatalogs(`http://127.0.0.1:${apiAddress.port}`, secret);
    expect(deleted.toolResult).toMatchObject({ isError: true });
    expect(JSON.stringify(deleted.toolResult)).toContain('MCP_UNAUTHORIZED');
    expect(deleted.stderr.join('')).not.toContain(secret);
  });
});
