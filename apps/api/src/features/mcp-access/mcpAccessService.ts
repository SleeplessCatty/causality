import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { McpTokenSecretResponse, McpTokenSummary } from '@causality/contracts';

import type { AuditWriter } from '../audit/auditRepository.js';
import type { RequestActor } from '../auth/requestActor.js';
import type { McpAccessRepository, McpTokenSummaryRecord } from './mcpAccessRepository.js';
import type { McpTokenCipher } from './mcpTokenCipher.js';

const MAX_TOKENS = 10;

type McpAccessErrorCode =
  | 'AUTH_REQUIRED'
  | 'TOKEN_LIMIT_REACHED'
  | 'TOKEN_NAME_EXISTS'
  | 'TOKEN_NOT_FOUND'
  | 'TOKEN_SECRET_UNAVAILABLE';

export class McpAccessServiceError extends Error {
  public constructor(
    public readonly code: McpAccessErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'McpAccessServiceError';
  }
}

export interface McpAccessServiceOptions {
  clock?: () => Date;
  requestIdGenerator?: () => string;
  tokenIdGenerator?: () => string;
  tokenGenerator?: () => string;
}

function digest(rawToken: string): Buffer {
  return createHash('sha256').update(rawToken).digest();
}

function summary(token: McpTokenSummaryRecord): McpTokenSummary {
  return {
    id: token.id,
    name: token.name,
    maskedToken: token.maskedToken,
    createdAt: token.createdAt.toISOString(),
    lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
  };
}

function userActor(actor: RequestActor): Extract<RequestActor, { actorType: 'user' }> {
  if (actor.actorType !== 'user') throw new McpAccessServiceError('AUTH_REQUIRED', '需要登录');
  return actor;
}

function isDuplicateName(error: unknown): boolean {
  const postgresError = error as { code?: string; constraint?: string };
  return (
    postgresError.code === '23505' &&
    postgresError.constraint === 'mcp_access_tokens_user_name_uidx'
  );
}

export class McpAccessService {
  private readonly clock: () => Date;
  private readonly requestIdGenerator: () => string;
  private readonly tokenIdGenerator: () => string;
  private readonly tokenGenerator: () => string;

  public constructor(
    private readonly repository: McpAccessRepository,
    private readonly auditWriter: AuditWriter,
    private readonly tokenCipher: McpTokenCipher,
    options: McpAccessServiceOptions = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
    this.requestIdGenerator = options.requestIdGenerator ?? randomUUID;
    this.tokenIdGenerator = options.tokenIdGenerator ?? randomUUID;
    this.tokenGenerator =
      options.tokenGenerator ?? (() => `cau_pat_${randomBytes(32).toString('base64url')}`);
  }

  public async create(actor: RequestActor, name: string): Promise<{ summary: McpTokenSummary }> {
    const user = userActor(actor);
    const normalizedName = name.trim();
    if (!normalizedName || normalizedName.length > 80) {
      throw new McpAccessServiceError('TOKEN_NOT_FOUND', '令牌名称无效');
    }
    const now = this.clock();
    const tokenId = this.tokenIdGenerator();
    const rawToken = this.tokenGenerator();
    const encrypted = this.tokenCipher.encrypt(rawToken, { userId: user.userId, tokenId });
    try {
      return await this.repository.withTransaction(async (client) => {
        if (!(await this.repository.lockEnabledUser(client, user.userId))) {
          throw new McpAccessServiceError('AUTH_REQUIRED', '需要登录');
        }
        if ((await this.repository.countForUser(client, user.userId)) >= MAX_TOKENS) {
          throw new McpAccessServiceError('TOKEN_LIMIT_REACHED', '最多保留 10 个 MCP 令牌');
        }
        const created = await this.repository.create(client, {
          id: tokenId,
          userId: user.userId,
          tokenDigest: digest(rawToken),
          name: normalizedName,
          maskedToken: this.tokenCipher.mask(rawToken),
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
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
        return { summary: summary(created) };
      });
    } catch (error) {
      if (isDuplicateName(error)) {
        throw new McpAccessServiceError('TOKEN_NAME_EXISTS', '令牌名称已存在');
      }
      throw error;
    }
  }

  public async list(actor: RequestActor): Promise<McpTokenSummary[]> {
    const user = userActor(actor);
    return this.repository.withTransaction(async (client) =>
      (await this.repository.listForUser(client, user.userId)).map(summary),
    );
  }

  public async getSecret(actor: RequestActor, tokenId: string): Promise<McpTokenSecretResponse> {
    const user = userActor(actor);
    return this.repository.withTransaction(async (client) => {
      const encrypted = await this.repository.findSecretForUser(client, user.userId, tokenId);
      if (!encrypted) {
        throw new McpAccessServiceError('TOKEN_NOT_FOUND', 'MCP 令牌不存在');
      }
      try {
        return {
          token: this.tokenCipher.decrypt(
            {
              ciphertext: encrypted.ciphertext,
              iv: encrypted.iv,
              authTag: encrypted.authTag,
            },
            { userId: encrypted.userId, tokenId: encrypted.id },
          ),
        };
      } catch {
        throw new McpAccessServiceError(
          'TOKEN_SECRET_UNAVAILABLE',
          'MCP 令牌暂时无法读取，请删除后重新创建',
        );
      }
    });
  }

  public async delete(actor: RequestActor, tokenId: string): Promise<void> {
    const user = userActor(actor);
    const now = this.clock();
    await this.repository.withTransaction(async (client) => {
      if (!(await this.repository.deleteForUser(client, user.userId, tokenId))) {
        throw new McpAccessServiceError('TOKEN_NOT_FOUND', 'MCP 令牌不存在');
      }
      await this.auditWriter.append(client, {
        actor: user,
        action: 'mcp_token.deleted',
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
      const token = await this.repository.findByDigest(client, digest(rawToken));
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
