import { describe, expect, it } from 'vitest';

import { loadMcpEnv } from '../src/config/env.js';

describe('MCP environment', () => {
  it('shares a strict internal bridge secret with the API and accepts an optional stdio token', () => {
    expect(loadMcpEnv({})).toMatchObject({
      CAUSALITY_INTERNAL_MCP_SECRET: 'ef'.repeat(32),
    });
    expect(
      loadMcpEnv({
        CAUSALITY_INTERNAL_MCP_SECRET: '12'.repeat(32),
        CAUSALITY_MCP_TOKEN: `cau_pat_${'4'.repeat(43)}`,
      }),
    ).toMatchObject({
      CAUSALITY_INTERNAL_MCP_SECRET: '12'.repeat(32),
      CAUSALITY_MCP_TOKEN: `cau_pat_${'4'.repeat(43)}`,
    });
    expect(() => loadMcpEnv({ CAUSALITY_INTERNAL_MCP_SECRET: 'short' })).toThrow();
  });

  it('rejects the development bridge secret in production', () => {
    expect(() => loadMcpEnv({ NODE_ENV: 'production' })).toThrow();
    expect(
      loadMcpEnv({ NODE_ENV: 'production', CAUSALITY_INTERNAL_MCP_SECRET: '12'.repeat(32) }),
    ).toMatchObject({ NODE_ENV: 'production' });
  });
});
