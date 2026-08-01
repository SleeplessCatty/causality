import { createHash } from 'node:crypto';

import type { PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';

import type { AuditWriteInput, AuditWriter } from '../src/features/audit/auditRepository.js';
import type { RequestActor } from '../src/features/auth/requestActor.js';
import {
  type CreateMcpAccessTokenInput,
  type McpAccessRepository,
  type McpAccessTokenRecord,
} from '../src/features/mcp-access/mcpAccessRepository.js';
import { McpAccessService } from '../src/features/mcp-access/mcpAccessService.js';

const fakeClient = {} as PoolClient;
const now = new Date('2026-08-01T00:00:00.000Z');
const actor: RequestActor = {
  actorType: 'user',
  userId: '10000000-0000-4000-8000-000000000001',
  username: 'jason',
  channel: 'web',
  requestId: 'request-1',
};

class MemoryRepository implements McpAccessRepository {
  readonly tokens: McpAccessTokenRecord[] = [];
  enabled = true;
  private number = 1;
  async withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    return work(fakeClient);
  }
  async lockEnabledUser(): Promise<boolean> {
    return this.enabled;
  }
  async countActiveForUser(_client: PoolClient, userId: string): Promise<number> {
    return this.tokens.filter((token) => token.userId === userId && !token.revokedAt).length;
  }
  async create(
    _client: PoolClient,
    input: CreateMcpAccessTokenInput,
  ): Promise<McpAccessTokenRecord> {
    const token: McpAccessTokenRecord = {
      id: `10000000-0000-4000-8000-${String(this.number++).padStart(12, '0')}`,
      userId: input.userId,
      username: 'jason',
      enabled: this.enabled,
      tokenDigest: input.tokenDigest,
      deviceName: input.deviceName,
      createdAt: input.createdAt,
      lastUsedAt: null,
      lastClientName: null,
      revokedAt: null,
    };
    this.tokens.push(token);
    return token;
  }
  async listForUser(_client: PoolClient, userId: string): Promise<McpAccessTokenRecord[]> {
    return this.tokens.filter((token) => token.userId === userId);
  }
  async revokeForUser(
    _client: PoolClient,
    userId: string,
    tokenId: string,
    at: Date,
  ): Promise<boolean> {
    const token = this.tokens.find(
      (item) => item.userId === userId && item.id === tokenId && !item.revokedAt,
    );
    if (!token) return false;
    token.revokedAt = at;
    return true;
  }
  async findActiveByDigest(
    _client: PoolClient,
    digest: Buffer,
  ): Promise<McpAccessTokenRecord | null> {
    return (
      this.tokens.find((token) => !token.revokedAt && token.tokenDigest.equals(digest)) ?? null
    );
  }
  async touchUsage(
    _client: PoolClient,
    tokenId: string,
    at: Date,
    clientName: string | null,
  ): Promise<void> {
    const token = this.tokens.find((item) => item.id === tokenId)!;
    if (!token.lastUsedAt || at.getTime() - token.lastUsedAt.getTime() >= 300_000) {
      token.lastUsedAt = at;
      token.lastClientName ??= clientName;
    }
  }
}

function service(repository = new MemoryRepository()) {
  const audit: AuditWriteInput[] = [];
  const writer: AuditWriter = {
    async append(_client, input) {
      audit.push(input);
    },
  };
  return {
    repository,
    audit,
    service: new McpAccessService(repository, writer, {
      clock: () => now,
      requestIdGenerator: () => 'mcp-request',
    }),
  };
}

describe('McpAccessService', () => {
  it('stores only a digest and returns the plaintext PAT exactly once', async () => {
    const harness = service();
    const created = await harness.service.create(actor, '  Desktop  ');
    expect(created.token).toMatch(/^cau_pat_[A-Za-z0-9_-]{43}$/);
    expect(harness.repository.tokens[0]).toMatchObject({ deviceName: 'Desktop' });
    expect(harness.repository.tokens[0]!.tokenDigest).toEqual(
      createHash('sha256').update(created.token).digest(),
    );
    expect(JSON.stringify(harness.repository.tokens)).not.toContain(created.token);
    expect((await harness.service.list(actor))[0]).not.toHaveProperty('token');
  });

  it('rejects creation for a user disabled while the user row is locked', async () => {
    const repository = new MemoryRepository();
    repository.enabled = false;
    await expect(service(repository).service.create(actor, 'Desktop')).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
    });
    expect(repository.tokens).toEqual([]);
  });

  it('rejects authorization immediately after revocation', async () => {
    const harness = service();
    const created = await harness.service.create(actor, 'Desktop');
    expect(await harness.service.authorize(created.token, 'Desktop')).toMatchObject({
      channel: 'mcp',
      mcpTokenId: created.summary.id,
    });
    await harness.service.revoke(actor, created.summary.id);
    await expect(harness.service.authorize(created.token)).resolves.toBeNull();
  });
});
