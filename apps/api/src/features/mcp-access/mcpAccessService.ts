import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { McpTokenSummary } from '@causality/contracts';

import type { AuditWriter } from '../audit/auditRepository.js';
import type { RequestActor } from '../auth/requestActor.js';
import type { McpAccessRepository, McpAccessTokenRecord } from './mcpAccessRepository.js';

const MAX_ACTIVE_TOKENS = 10;

export class McpAccessServiceError extends Error {
  public constructor(
    public readonly code: 'AUTH_REQUIRED' | 'TOKEN_LIMIT_REACHED' | 'TOKEN_NOT_FOUND',
    message: string,
  ) {
    super(message);
    this.name = 'McpAccessServiceError';
  }
}

export interface McpAccessServiceOptions {
  clock?: () => Date;
  requestIdGenerator?: () => string;
}

function digest(rawToken: string): Buffer {
  return createHash('sha256').update(rawToken).digest();
}

function summary(token: McpAccessTokenRecord): McpTokenSummary {
  return {
    id: token.id,
    deviceName: token.deviceName,
    createdAt: token.createdAt.toISOString(),
    lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
    lastClientName: token.lastClientName,
    revokedAt: token.revokedAt?.toISOString() ?? null,
  };
}

function userActor(actor: RequestActor): Extract<RequestActor, { actorType: 'user' }> {
  if (actor.actorType !== 'user') throw new McpAccessServiceError('AUTH_REQUIRED', '需要登录');
  return actor;
}

export class McpAccessService {
  private readonly clock: () => Date;
  private readonly requestIdGenerator: () => string;

  public constructor(
    private readonly repository: McpAccessRepository,
    private readonly auditWriter: AuditWriter,
    options: McpAccessServiceOptions = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
    this.requestIdGenerator = options.requestIdGenerator ?? randomUUID;
  }

  public async create(
    actor: RequestActor,
    deviceName: string,
  ): Promise<{ token: string; summary: McpTokenSummary }> {
    const user = userActor(actor);
    const normalizedDeviceName = deviceName.trim();
    if (!normalizedDeviceName || normalizedDeviceName.length > 80) {
      throw new McpAccessServiceError('TOKEN_NOT_FOUND', '设备名称无效');
    }
    const now = this.clock();
    const token = `cau_pat_${randomBytes(32).toString('base64url')}`;
    return this.repository.withTransaction(async (client) => {
      if (!(await this.repository.lockEnabledUser(client, user.userId))) {
        throw new McpAccessServiceError('AUTH_REQUIRED', '需要登录');
      }
      if ((await this.repository.countActiveForUser(client, user.userId)) >= MAX_ACTIVE_TOKENS) {
        throw new McpAccessServiceError('TOKEN_LIMIT_REACHED', '最多保留 10 个有效 MCP 令牌');
      }
      const created = await this.repository.create(client, {
        userId: user.userId,
        tokenDigest: digest(token),
        deviceName: normalizedDeviceName,
        createdAt: now,
      });
      await this.auditWriter.append(client, {
        actor: user,
        action: 'mcp_token.created',
        targetType: 'mcp_token',
        targetId: created.id,
        result: 'success',
        occurredAt: now,
      });
      return { token, summary: summary(created) };
    });
  }

  public async list(actor: RequestActor): Promise<McpTokenSummary[]> {
    const user = userActor(actor);
    return this.repository.withTransaction(async (client) =>
      (await this.repository.listForUser(client, user.userId)).map(summary),
    );
  }

  public async revoke(actor: RequestActor, tokenId: string): Promise<void> {
    const user = userActor(actor);
    const now = this.clock();
    await this.repository.withTransaction(async (client) => {
      if (!(await this.repository.revokeForUser(client, user.userId, tokenId, now))) {
        throw new McpAccessServiceError('TOKEN_NOT_FOUND', 'MCP 令牌不存在');
      }
      await this.auditWriter.append(client, {
        actor: user,
        action: 'mcp_token.revoked',
        targetType: 'mcp_token',
        targetId: tokenId,
        result: 'success',
        occurredAt: now,
      });
    });
  }

  public async authorize(
    rawToken: string,
    clientName: string | null = null,
  ): Promise<RequestActor | null> {
    if (!/^cau_pat_[A-Za-z0-9_-]{43}$/.test(rawToken)) return null;
    const now = this.clock();
    return this.repository.withTransaction(async (client) => {
      const token = await this.repository.findActiveByDigest(client, digest(rawToken));
      if (!token || !token.enabled) return null;
      await this.repository.touchUsage(client, token.id, now, clientName?.slice(0, 120) ?? null);
      return {
        actorType: 'user',
        userId: token.userId,
        username: token.username,
        channel: 'mcp',
        requestId: this.requestIdGenerator(),
        mcpTokenId: token.id,
      };
    });
  }
}
