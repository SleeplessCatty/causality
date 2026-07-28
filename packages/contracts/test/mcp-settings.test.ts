import { describe, expect, it } from 'vitest';

import { mcpSettingsResponseSchema, mcpTokenRotationResponseSchema } from '../src/index.js';

const token = 'a'.repeat(64);
const settings = {
  serviceStatus: 'running',
  endpoint: 'http://127.0.0.1:8081/mcp',
  maskedToken: `${'•'.repeat(12)}aaaa`,
  accessToken: token,
  tokenVersion: 1,
  updatedAt: '2026-07-28T10:00:00.000Z',
  clientConfig: {
    transport: 'streamable-http',
    url: 'http://127.0.0.1:8081/mcp',
    headers: { Authorization: `Bearer ${token}` },
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
      tokenVersion: 1,
    });
  });

  it('requires a 64-character lowercase hexadecimal token and positive version', () => {
    expect(
      mcpSettingsResponseSchema.safeParse({ ...settings, accessToken: 'not-a-token' }).success,
    ).toBe(false);
    expect(mcpSettingsResponseSchema.safeParse({ ...settings, tokenVersion: 0 }).success).toBe(
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
    expect(
      mcpSettingsResponseSchema.safeParse({
        ...settings,
        clientConfig: {
          ...settings.clientConfig,
          headers: { Authorization: `Bearer ${'b'.repeat(64)}` },
        },
      }).success,
    ).toBe(false);
  });

  it('wraps the newly rotated settings and rejects unknown properties', () => {
    expect(mcpTokenRotationResponseSchema.parse({ settings })).toEqual({ settings });
    expect(mcpTokenRotationResponseSchema.safeParse({ settings, oldToken: token }).success).toBe(
      false,
    );
  });
});
