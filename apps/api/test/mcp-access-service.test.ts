import { createHash } from 'node:crypto';

import type { PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';

import type { AuditWriteInput, AuditWriter } from '../src/features/audit/auditRepository.js';
import type { RequestActor } from '../src/features/auth/requestActor.js';
import {
  type CreateMcpAccessTokenInput,
  type McpAccessRepository,
  type McpAuthorizationTokenRecord,
  type McpEncryptedTokenRecord,
  type McpTokenSummaryRecord,
} from '../src/features/mcp-access/mcpAccessRepository.js';
import { McpAccessService } from '../src/features/mcp-access/mcpAccessService.js';
import { createAesGcmMcpTokenCipher } from '../src/features/mcp-access/mcpTokenCipher.js';

const fakeClient = {} as PoolClient;
const now = new Date('2026-08-01T00:00:00.000Z');
const userId = '10000000-0000-4000-8000-000000000001';
const tokenId = '20000000-0000-4000-8000-000000000001';
const rawToken = `cau_pat_${'a'.repeat(43)}`;
const actor: RequestActor = {
  actorType: 'user',
  userId,
  username: 'jason',
  channel: 'web',
  requestId: 'request-1',
};

type StoredToken = McpTokenSummaryRecord & McpEncryptedTokenRecord & McpAuthorizationTokenRecord;

class MemoryRepository implements McpAccessRepository {
  readonly tokens: StoredToken[] = [];
  enabled = true;

  async withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    return work(fakeClient);
  }
  async lockEnabledUser(): Promise<boolean> {
    return this.enabled;
  }
  async countForUser(_client: PoolClient, targetUserId: string): Promise<number> {
    return this.tokens.filter((token) => token.userId === targetUserId).length;
  }
  async create(
    _client: PoolClient,
    input: CreateMcpAccessTokenInput,
  ): Promise<McpTokenSummaryRecord> {
    if (
      this.tokens.some(
        (token) =>
          token.userId === input.userId && token.name.toLowerCase() === input.name.toLowerCase(),
      )
    ) {
      throw Object.assign(new Error('duplicate token name'), {
        code: '23505',
        constraint: 'mcp_access_tokens_user_name_uidx',
      });
    }
    const token: StoredToken = {
      id: input.id,
      userId: input.userId,
      username: 'jason',
      enabled: this.enabled,
      tokenDigest: input.tokenDigest,
      name: input.name,
      maskedToken: input.maskedToken,
      createdAt: input.createdAt,
      lastUsedAt: null,
      ciphertext: input.ciphertext,
      iv: input.iv,
      authTag: input.authTag,
    };
    this.tokens.push(token);
    return token;
  }
  async listForUser(_client: PoolClient, targetUserId: string): Promise<McpTokenSummaryRecord[]> {
    return this.tokens.filter((token) => token.userId === targetUserId);
  }
  async findSecretForUser(
    _client: PoolClient,
    targetUserId: string,
    targetTokenId: string,
  ): Promise<McpEncryptedTokenRecord | null> {
    return (
      this.tokens.find((token) => token.userId === targetUserId && token.id === targetTokenId) ??
      null
    );
  }
  async deleteForUser(
    _client: PoolClient,
    targetUserId: string,
    targetTokenId: string,
  ): Promise<boolean> {
    const index = this.tokens.findIndex(
      (token) => token.userId === targetUserId && token.id === targetTokenId,
    );
    if (index < 0) return false;
    this.tokens.splice(index, 1);
    return true;
  }
  async findByDigest(
    _client: PoolClient,
    digest: Buffer,
  ): Promise<McpAuthorizationTokenRecord | null> {
    return this.tokens.find((token) => token.tokenDigest.equals(digest)) ?? null;
  }
  async touchUsage(_client: PoolClient, targetTokenId: string, at: Date): Promise<void> {
    const token = this.tokens.find((item) => item.id === targetTokenId);
    if (token) token.lastUsedAt = at;
  }
}

function createHarness(repository = new MemoryRepository()) {
  const audit: AuditWriteInput[] = [];
  const writer: AuditWriter = {
    async append(_client, input) {
      audit.push(input);
    },
  };
  const cipher = createAesGcmMcpTokenCipher(Buffer.alloc(32, 0x74).toString('base64'));
  return {
    repository,
    audit,
    service: new McpAccessService(repository, writer, cipher, {
      clock: () => now,
      requestIdGenerator: () => 'mcp-request',
      tokenIdGenerator: () => tokenId,
      tokenGenerator: () => rawToken,
    }),
  };
}

describe('McpAccessService', () => {
  it('creates an encrypted token and recovers it only through the secret operation', async () => {
    const harness = createHarness();
    const created = await harness.service.create(actor, '  Codex  ');

    expect(created).toEqual({
      summary: {
        id: tokenId,
        name: 'Codex',
        maskedToken: 'cau_pat_aaaa••••aaaa',
        createdAt: now.toISOString(),
        lastUsedAt: null,
      },
    });
    expect(harness.repository.tokens[0]?.tokenDigest).toEqual(
      createHash('sha256').update(rawToken).digest(),
    );
    expect(JSON.stringify(harness.repository.tokens)).not.toContain(rawToken);
    expect(await harness.service.list(actor)).toEqual([created.summary]);
    expect(await harness.service.getSecret(actor, tokenId)).toEqual({ token: rawToken });
    expect(harness.audit[0]?.action).toBe('mcp_token.created');
  });

  it('rejects case-insensitive duplicate names and disabled users', async () => {
    const harness = createHarness();
    await harness.service.create(actor, 'Codex');
    await expect(harness.service.create(actor, 'codex')).rejects.toMatchObject({
      code: 'TOKEN_NAME_EXISTS',
    });

    const disabledRepository = new MemoryRepository();
    disabledRepository.enabled = false;
    await expect(
      createHarness(disabledRepository).service.create(actor, 'Desktop'),
    ).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
    });
  });

  it('hard-deletes a token and rejects its next authorization attempt', async () => {
    const harness = createHarness();
    const created = await harness.service.create(actor, 'Codex');
    expect(await harness.service.authorize(rawToken, 'Codex')).toMatchObject({
      channel: 'mcp',
      mcpTokenId: created.summary.id,
    });

    await harness.service.delete(actor, created.summary.id);

    expect(harness.repository.tokens).toEqual([]);
    await expect(harness.service.authorize(rawToken)).resolves.toBeNull();
    expect(harness.audit.at(-1)?.action).toBe('mcp_token.deleted');
  });

  it('hides foreign tokens and converts decryption failures into a stable error', async () => {
    const harness = createHarness();
    await harness.service.create(actor, 'Codex');
    await expect(
      harness.service.getSecret(
        { ...actor, userId: '10000000-0000-4000-8000-000000000002' },
        tokenId,
      ),
    ).rejects.toMatchObject({ code: 'TOKEN_NOT_FOUND' });

    harness.repository.tokens[0]!.authTag = Buffer.alloc(16);
    await expect(harness.service.getSecret(actor, tokenId)).rejects.toMatchObject({
      code: 'TOKEN_SECRET_UNAVAILABLE',
    });
  });
});
