import { describe, expect, it } from 'vitest';

import { createAesGcmMcpTokenCipher } from '../src/features/mcp-access/mcpTokenCipher.js';

const token = `cau_pat_${'a'.repeat(39)}wxyz`;
const key = Buffer.alloc(32, 0x42).toString('base64');
const context = {
  userId: '10000000-0000-4000-8000-000000000001',
  tokenId: '20000000-0000-4000-8000-000000000001',
};

describe('MCP token cipher', () => {
  it('round-trips a token with a fresh IV and stable masked representation', () => {
    const cipher = createAesGcmMcpTokenCipher(key);
    const first = cipher.encrypt(token, context);
    const second = cipher.encrypt(token, context);

    expect(cipher.decrypt(first, context)).toBe(token);
    expect(second.iv).not.toEqual(first.iv);
    expect(first.iv).toHaveLength(12);
    expect(first.authTag).toHaveLength(16);
    expect(cipher.mask(token)).toBe('cau_pat_aaaa••••wxyz');
  });

  it('rejects foreign ownership context and authenticated-data tampering', () => {
    const cipher = createAesGcmMcpTokenCipher(key);
    const encrypted = cipher.encrypt(token, context);

    expect(() =>
      cipher.decrypt(encrypted, {
        ...context,
        userId: '10000000-0000-4000-8000-000000000002',
      }),
    ).toThrow('Unable to decrypt MCP token');
    expect(() => cipher.decrypt({ ...encrypted, authTag: Buffer.alloc(16) }, context)).toThrow(
      'Unable to decrypt MCP token',
    );
  });

  it('rejects malformed keys and tokens', () => {
    expect(() => createAesGcmMcpTokenCipher('not-base64')).toThrow(
      'Invalid MCP token encryption key',
    );
    expect(() => createAesGcmMcpTokenCipher(Buffer.alloc(31).toString('base64'))).toThrow(
      'Invalid MCP token encryption key',
    );
    expect(() => createAesGcmMcpTokenCipher(key).encrypt('invalid-token', context)).toThrow(
      'Invalid MCP personal access token',
    );
  });
});
