import { mcpSettingsResponseSchema, mcpTokenRotationResponseSchema } from '@causality/contracts';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresMcpSettingsRepository } from '../src/features/mcp-settings/mcpSettingsRepository.js';
import {
  McpSettingsService,
  type McpHealthProbe,
} from '../src/features/mcp-settings/mcpSettingsService.js';
import { registerMcpSettingsRoutes } from '../src/features/mcp-settings/mcpSettingsRoutes.js';
import { startPostgresTestContext } from './support/postgresTestContext.js';

describe.sequential('MCP settings PostgreSQL and HTTP API', () => {
  const internalMcpSecret = 'ef'.repeat(32);
  let context: Awaited<ReturnType<typeof startPostgresTestContext>>;
  let repository: PostgresMcpSettingsRepository;

  beforeAll(async () => {
    context = await startPostgresTestContext('causality_mcp_settings_test');
    repository = new PostgresMcpSettingsRepository(context.pool);
  }, 120_000);

  afterAll(async () => {
    await context.close();
  });

  it('compares exact tokens and immediately invalidates the old token after rotation', async () => {
    const before = await repository.get();

    await expect(repository.authorize(before.accessToken)).resolves.toBe(true);
    await expect(repository.authorize(before.accessToken.toUpperCase())).resolves.toBe(false);
    await expect(repository.authorize('short-token')).resolves.toBe(false);

    const after = await repository.rotate();

    expect(after.accessToken).toMatch(/^[0-9a-f]{64}$/);
    expect(after.accessToken).not.toBe(before.accessToken);
    expect(after.tokenVersion).toBe(before.tokenVersion + 1);
    await expect(repository.authorize(before.accessToken)).resolves.toBe(false);
    await expect(repository.authorize(after.accessToken)).resolves.toBe(true);
  });

  it('returns a complete client configuration while a failed health probe reports stopped', async () => {
    const probe: McpHealthProbe = async () => {
      throw new Error('connection refused');
    };
    const service = new McpSettingsService(repository, {
      endpoint: 'http://127.0.0.1:8081/mcp',
      healthUrl: 'http://127.0.0.1:8081/health',
      healthTimeoutMs: 20,
      probe,
    });

    const settings = await service.get();

    expect(mcpSettingsResponseSchema.safeParse(settings).success).toBe(true);
    expect(settings).toMatchObject({
      serviceStatus: 'stopped',
      endpoint: 'http://127.0.0.1:8081/mcp',
      maskedToken: expect.stringMatching(/^.{4}•+.{4}$/),
      clientConfig: {
        transport: 'streamable-http',
        url: 'http://127.0.0.1:8081/mcp',
        headers: { Authorization: `Bearer ${settings.accessToken}` },
      },
    });
  });

  it('exposes settings and rotation locally and returns only authorization state plus token version', async () => {
    const service = new McpSettingsService(repository, {
      endpoint: 'http://127.0.0.1:8081/mcp',
      healthUrl: 'http://127.0.0.1:8081/health',
      probe: async () => true,
    });
    const app = Fastify({ logger: false });
    registerMcpSettingsRoutes(app, service);
    await app.ready();
    try {
      const initial = await app.inject({ method: 'GET', url: '/api/mcp/settings' });
      const initialSettings = initial.json();
      const invalid = await app.inject({
        method: 'POST',
        url: '/api/mcp/authorize',
        headers: {
          'x-causality-mcp-token': 'b'.repeat(64),
          'x-causality-internal-mcp-secret': internalMcpSecret,
        },
      });
      const authorized = await app.inject({
        method: 'POST',
        url: '/api/mcp/authorize',
        headers: {
          'x-causality-mcp-token': initialSettings.accessToken,
          'x-causality-internal-mcp-secret': internalMcpSecret,
        },
      });
      const rotated = await app.inject({
        method: 'POST',
        url: '/api/mcp/settings/rotate-token',
      });

      expect(initial.statusCode).toBe(200);
      expect(mcpSettingsResponseSchema.safeParse(initialSettings).success).toBe(true);
      expect(invalid.statusCode).toBe(401);
      expect(authorized.statusCode).toBe(200);
      expect(authorized.json()).toEqual({
        authorized: true,
        tokenVersion: initialSettings.tokenVersion,
      });
      expect(Object.keys(authorized.json()).toSorted()).toEqual(['authorized', 'tokenVersion']);
      expect(rotated.statusCode).toBe(200);
      expect(mcpTokenRotationResponseSchema.safeParse(rotated.json()).success).toBe(true);

      const stale = await app.inject({
        method: 'POST',
        url: '/api/mcp/authorize',
        headers: {
          'x-causality-mcp-token': initialSettings.accessToken,
          'x-causality-internal-mcp-secret': internalMcpSecret,
        },
      });
      expect(stale.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});
