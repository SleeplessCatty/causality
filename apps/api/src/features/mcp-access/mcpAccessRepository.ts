import type { Pool, PoolClient } from 'pg';

export interface McpAccessTokenRecord {
  id: string;
  userId: string;
  username: string;
  enabled: boolean;
  tokenDigest: Buffer;
  deviceName: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  lastClientName: string | null;
  revokedAt: Date | null;
}

export interface CreateMcpAccessTokenInput {
  userId: string;
  tokenDigest: Buffer;
  deviceName: string;
  createdAt: Date;
}

export interface McpAccessRepository {
  withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T>;
  countActiveForUser(client: PoolClient, userId: string): Promise<number>;
  create(client: PoolClient, input: CreateMcpAccessTokenInput): Promise<McpAccessTokenRecord>;
  listForUser(client: PoolClient, userId: string): Promise<McpAccessTokenRecord[]>;
  revokeForUser(client: PoolClient, userId: string, tokenId: string, now: Date): Promise<boolean>;
  findActiveByDigest(client: PoolClient, tokenDigest: Buffer): Promise<McpAccessTokenRecord | null>;
  touchUsage(
    client: PoolClient,
    tokenId: string,
    now: Date,
    clientName: string | null,
  ): Promise<void>;
}

type TokenRow = {
  id: string;
  user_id: string;
  username: string;
  enabled: boolean;
  token_digest: Buffer;
  device_name: string;
  created_at: Date;
  last_used_at: Date | null;
  last_client_name: string | null;
  revoked_at: Date | null;
};

function mapRecord(row: TokenRow): McpAccessTokenRecord {
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username,
    enabled: row.enabled,
    tokenDigest: row.token_digest,
    deviceName: row.device_name,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    lastClientName: row.last_client_name,
    revokedAt: row.revoked_at,
  };
}

const selectColumns = `
  select t.id, t.user_id, u.username, u.enabled, t.token_digest, t.device_name,
         t.created_at, t.last_used_at, t.last_client_name, t.revoked_at
  from mcp_access_tokens t join users u on u.id = t.user_id`;

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

  public async countActiveForUser(client: PoolClient, userId: string): Promise<number> {
    await client.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [userId]);
    const result = await client.query<{ count: string }>(
      `select count(*) from mcp_access_tokens where user_id = $1 and revoked_at is null`,
      [userId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  public async create(client: PoolClient, input: CreateMcpAccessTokenInput): Promise<McpAccessTokenRecord> {
    const inserted = await client.query<TokenRow>(
      `with inserted as (
         insert into mcp_access_tokens (user_id, token_digest, device_name, created_at)
         values ($1, $2, $3, $4)
         returning id, user_id, token_digest, device_name, created_at, last_used_at, last_client_name, revoked_at
       )
       select inserted.id, inserted.user_id, users.username, users.enabled, inserted.token_digest,
              inserted.device_name, inserted.created_at, inserted.last_used_at, inserted.last_client_name,
              inserted.revoked_at
       from inserted join users on users.id = inserted.user_id`,
      [input.userId, input.tokenDigest, input.deviceName, input.createdAt],
    );
    const row = inserted.rows[0];
    if (!row) throw new Error('Unable to create MCP access token');
    return mapRecord(row);
  }

  public async listForUser(client: PoolClient, userId: string): Promise<McpAccessTokenRecord[]> {
    const result = await client.query<TokenRow>(
      `${selectColumns} where t.user_id = $1 order by t.created_at desc, t.id desc`,
      [userId],
    );
    return result.rows.map(mapRecord);
  }

  public async revokeForUser(
    client: PoolClient,
    userId: string,
    tokenId: string,
    now: Date,
  ): Promise<boolean> {
    const result = await client.query(
      `update mcp_access_tokens set revoked_at = $3
       where id = $1 and user_id = $2 and revoked_at is null`,
      [tokenId, userId, now],
    );
    return result.rowCount === 1;
  }

  public async findActiveByDigest(
    client: PoolClient,
    tokenDigest: Buffer,
  ): Promise<McpAccessTokenRecord | null> {
    const result = await client.query<TokenRow>(
      `${selectColumns} where t.token_digest = $1 and t.revoked_at is null for update`,
      [tokenDigest],
    );
    return result.rows[0] ? mapRecord(result.rows[0]) : null;
  }

  public async touchUsage(
    client: PoolClient,
    tokenId: string,
    now: Date,
    clientName: string | null,
  ): Promise<void> {
    await client.query(
      `update mcp_access_tokens
       set last_used_at = $2, last_client_name = $3
       where id = $1 and revoked_at is null
         and (last_used_at is null or last_used_at <= $2 - interval '5 minutes')`,
      [tokenId, now, clientName],
    );
  }
}
