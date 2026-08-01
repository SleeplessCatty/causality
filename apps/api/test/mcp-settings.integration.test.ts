import { mcpSettingsResponseSchema } from '@causality/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startPostgresTestContext } from './support/postgresTestContext.js';

describe.sequential('MCP settings HTTP API', () => {
  let context: Awaited<ReturnType<typeof startPostgresTestContext>>;

  beforeAll(async () => {
    context = await startPostgresTestContext('causality_mcp_settings_test');
  }, 120_000);

  afterAll(async () => {
    await context.close();
  });

  it('returns connection help without revealing a reusable token', async () => {
    const response = await context.app.inject({ method: 'GET', url: '/api/mcp/settings' });
    expect(response.statusCode).toBe(200);
    expect(mcpSettingsResponseSchema.parse(response.json())).toMatchObject({
      endpoint: 'http://127.0.0.1:8081/mcp',
      clientConfig: { transport: 'streamable-http' },
    });
    expect(response.json()).not.toHaveProperty('accessToken');
  });

  it('does not retain global token authorization or rotation endpoints', async () => {
    await expect(
      context.anonymousInject({ method: 'POST', url: '/api/mcp/authorize' }),
    ).resolves.toMatchObject({ statusCode: 404 });
    await expect(
      context.app.inject({ method: 'POST', url: '/api/mcp/settings/rotate-token' }),
    ).resolves.toMatchObject({ statusCode: 404 });
  });
});
