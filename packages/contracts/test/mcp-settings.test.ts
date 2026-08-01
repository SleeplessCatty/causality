import { describe, expect, it } from 'vitest';

import {
  apiErrorSchema,
  createMcpTokenInputSchema,
  createMcpTokenResponseSchema,
  mcpAuthorizationResponseSchema,
  mcpPersonalAccessTokenSchema,
  mcpSettingsResponseSchema,
  mcpTokenSummarySchema,
  revokeMcpTokenResponseSchema,
} from '../src/index.js';

const token = `cau_pat_${'a'.repeat(43)}`;
const tokenId = '10000000-0000-4000-8000-000000000001';
const settings = {
  serviceStatus: 'running',
  endpoint: 'http://127.0.0.1:8081/mcp',
  updatedAt: '2026-07-28T10:00:00.000Z',
  clientConfig: {
    transport: 'streamable-http',
    url: 'http://127.0.0.1:8081/mcp',
  },
};

describe('MCP settings contracts', () => {
  it('accepts a strict local Streamable HTTP configuration', () => {
    expect(mcpSettingsResponseSchema.parse(settings)).toEqual(settings);
  });

  it('accepts stopped service status without losing connection settings', () => {
    expect(
      mcpSettingsResponseSchema.parse({ ...settings, serviceStatus: 'stopped' }),
    ).toMatchObject({
      serviceStatus: 'stopped',
      endpoint: settings.endpoint,
    });
  });

  it('does not expose a reusable access token from MCP settings', () => {
    const personalSettings = {
      serviceStatus: 'running',
      endpoint: 'http://127.0.0.1:8081/mcp',
      updatedAt: '2026-07-28T10:00:00.000Z',
      clientConfig: { transport: 'streamable-http', url: 'http://127.0.0.1:8081/mcp' },
    };

    expect(mcpSettingsResponseSchema.safeParse(personalSettings).success).toBe(true);
  });

  it('rejects a settings response that leaks an access token', () => {
    expect(mcpSettingsResponseSchema.safeParse({ ...settings, accessToken: token }).success).toBe(
      false,
    );
  });

  it('rejects client configuration that disagrees with the endpoint or access token', () => {
    expect(
      mcpSettingsResponseSchema.safeParse({
        ...settings,
        clientConfig: { ...settings.clientConfig, url: 'http://127.0.0.1:9999/mcp' },
      }).success,
    ).toBe(false);
  });

  it('accepts one-time personal token creation and safe summaries', () => {
    const summary = {
      id: tokenId,
      deviceName: 'Jason desktop',
      createdAt: '2026-07-28T10:00:00.000Z',
      lastUsedAt: null,
      lastClientName: null,
      revokedAt: null,
    };
    expect(mcpPersonalAccessTokenSchema.parse(token)).toBe(token);
    expect(mcpTokenSummarySchema.parse(summary)).toEqual(summary);
    expect(createMcpTokenInputSchema.parse({ deviceName: '  Jason desktop  ' })).toEqual({
      deviceName: 'Jason desktop',
    });
    expect(createMcpTokenResponseSchema.parse({ token, summary })).toEqual({ token, summary });
    expect(revokeMcpTokenResponseSchema.parse({ revoked: true })).toEqual({ revoked: true });
  });

  it('enforces device-name and personal-token boundaries', () => {
    expect(createMcpTokenInputSchema.safeParse({ deviceName: '   ' }).success).toBe(false);
    expect(createMcpTokenInputSchema.safeParse({ deviceName: 'a'.repeat(81) }).success).toBe(false);
    expect(mcpPersonalAccessTokenSchema.safeParse(`cau_pat_${'a'.repeat(42)}`).success).toBe(false);
  });

  it('returns MCP authorization identity without a global token version', () => {
    const authorization = {
      authorized: true,
      userId: '10000000-0000-4000-8000-000000000002',
      username: 'jason',
      tokenId,
    };
    expect(mcpAuthorizationResponseSchema.parse(authorization)).toEqual(authorization);
    expect(
      mcpAuthorizationResponseSchema.safeParse({ ...authorization, tokenVersion: 1 }).success,
    ).toBe(false);
  });

  it('accepts personal-token API error codes', () => {
    for (const code of ['TOKEN_LIMIT_REACHED', 'TOKEN_NOT_FOUND'] as const) {
      expect(apiErrorSchema.parse({ code, message: 'MCP 令牌操作失败' })).toEqual({
        code,
        message: 'MCP 令牌操作失败',
      });
    }
  });
});
