import type { Pool, PoolClient } from 'pg';

export interface McpTokenSummaryRecord {
  id: string;
  userId: string;
  name: string;
  maskedToken: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export interface McpEncryptedTokenRecord {
  id: string;
  userId: string;
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

export interface McpAuthorizationTokenRecord {
  id: string;
  userId: string;
  username: string;
  enabled: boolean;
  tokenDigest: Buffer;
}

export interface CreateMcpAccessTokenInput {
  id: string;
  userId: string;
  tokenDigest: Buffer;
  name: string;
  maskedToken: string;
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  createdAt: Date;
}

export interface McpAccessRepository {
  withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T>;
  lockEnabledUser(client: PoolClient, userId: string): Promise<boolean>;
  countForUser(client: PoolClient, userId: string): Promise<number>;
  create(client: PoolClient, input: CreateMcpAccessTokenInput): Promise<McpTokenSummaryRecord>;
  listForUser(client: PoolClient, userId: string): Promise<McpTokenSummaryRecord[]>;
  findSecretForUser(
    client: PoolClient,
    userId: string,
    tokenId: string,
  ): Promise<McpEncryptedTokenRecord | null>;
  deleteForUser(client: PoolClient, userId: string, tokenId: string): Promise<boolean>;
  findByDigest(
    client: PoolClient,
    tokenDigest: Buffer,
  ): Promise<McpAuthorizationTokenRecord | null>;
  touchUsage(
    client: PoolClient,
    tokenId: string,
    now: Date,
    clientName: string | null,
  ): Promise<void>;
}

type SummaryRow = {
  id: string;
  user_id: string;
  name: string;
  masked_token: string;
  created_at: Date;
  last_used_at: Date | null;
};

function mapSummary(row: SummaryRow): McpTokenSummaryRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    maskedToken: row.masked_token,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

export class PostgresMcpAccessRepository implements McpAccessRepository {
  public constructor(private readonly pool: Pool) {}

  public async withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await work(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  public async countForUser(client: PoolClient, userId: string): Promise<number> {
    const result = await client.query<{ count: string }>(
      `select count(*) from mcp_access_tokens where user_id = $1`,
      [userId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  public async lockEnabledUser(client: PoolClient, userId: string): Promise<boolean> {
    const result = await client.query<{ enabled: boolean }>(
      `select enabled from users where id = $1 for update`,
      [userId],
    );
    return result.rows[0]?.enabled === true;
  }

  public async create(
    client: PoolClient,
    input: CreateMcpAccessTokenInput,
  ): Promise<McpTokenSummaryRecord> {
    const inserted = await client.query<SummaryRow>(
      `insert into mcp_access_tokens (
         id, user_id, token_digest, name, masked_token,
         token_ciphertext, token_iv, token_auth_tag, created_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning id, user_id, name, masked_token, created_at, last_used_at`,
      [
        input.id,
        input.userId,
        input.tokenDigest,
        input.name,
        input.maskedToken,
        input.ciphertext,
        input.iv,
        input.authTag,
        input.createdAt,
      ],
    );
    const row = inserted.rows[0];
    if (!row) throw new Error('Unable to create MCP access token');
    return mapSummary(row);
  }

  public async listForUser(client: PoolClient, userId: string): Promise<McpTokenSummaryRecord[]> {
    const result = await client.query<SummaryRow>(
      `select id, user_id, name, masked_token, created_at, last_used_at
       from mcp_access_tokens
       where user_id = $1
       order by created_at desc, id desc`,
      [userId],
    );
    return result.rows.map(mapSummary);
  }

  public async findSecretForUser(
    client: PoolClient,
    userId: string,
    tokenId: string,
  ): Promise<McpEncryptedTokenRecord | null> {
    const result = await client.query<{
      id: string;
      user_id: string;
      token_ciphertext: Buffer;
      token_iv: Buffer;
      token_auth_tag: Buffer;
    }>(
      `select id, user_id, token_ciphertext, token_iv, token_auth_tag
       from mcp_access_tokens
       where id = $1 and user_id = $2`,
      [tokenId, userId],
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          userId: row.user_id,
          ciphertext: row.token_ciphertext,
          iv: row.token_iv,
          authTag: row.token_auth_tag,
        }
      : null;
  }

  public async deleteForUser(
    client: PoolClient,
    userId: string,
    tokenId: string,
  ): Promise<boolean> {
    const result = await client.query(
      `delete from mcp_access_tokens where id = $1 and user_id = $2`,
      [tokenId, userId],
    );
    return result.rowCount === 1;
  }

  public async findByDigest(
    client: PoolClient,
    tokenDigest: Buffer,
  ): Promise<McpAuthorizationTokenRecord | null> {
    const result = await client.query<{
      id: string;
      user_id: string;
      username: string;
      enabled: boolean;
      token_digest: Buffer;
    }>(
      `select t.id, t.user_id, u.username, u.enabled, t.token_digest
       from mcp_access_tokens t
       join users u on u.id = t.user_id
       where t.token_digest = $1
       for update of t`,
      [tokenDigest],
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          userId: row.user_id,
          username: row.username,
          enabled: row.enabled,
          tokenDigest: row.token_digest,
        }
      : null;
  }

  public async touchUsage(
    client: PoolClient,
    tokenId: string,
    now: Date,
    clientName: string | null,
  ): Promise<void> {
    await client.query(
      `update mcp_access_tokens
       set last_used_at = $2::timestamptz, last_client_name = coalesce($3, last_client_name)
       where id = $1
         and (last_used_at is null or last_used_at <= $2::timestamptz - interval '5 minutes')`,
      [tokenId, now, clientName],
    );
  }
}
