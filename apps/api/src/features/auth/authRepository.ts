import type { Pool, PoolClient } from 'pg';

export interface AuthUserRecord {
  id: string;
  username: string;
  normalizedUsername: string;
  passwordHash: string;
  mustChangePassword: boolean;
  enabled: boolean;
  failedLoginCount: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthSessionRecord {
  id: string;
  userId: string;
  tokenHash: Buffer;
  csrfTokenHash: Buffer;
  createdAt: Date;
  lastSeenAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
}

export interface CreateSessionInput {
  userId: string;
  tokenHash: Buffer;
  csrfTokenHash: Buffer;
  createdAt: Date;
  lastSeenAt: Date;
  absoluteExpiresAt: Date;
}

export interface AuthSourceRateLimitRecord {
  sourceDigest: Buffer;
  failureCount: number;
  windowStartedAt: Date;
  blockedUntil: Date | null;
  updatedAt: Date;
}

export interface AuthRepository {
  withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T>;
  findUserByUsername(client: PoolClient, username: string): Promise<AuthUserRecord | null>;
  findUserById(client: PoolClient, userId: string): Promise<AuthUserRecord | null>;
  setUserLoginFailure(
    client: PoolClient,
    userId: string,
    failedLoginCount: number,
    lockedUntil: Date | null,
    updatedAt: Date,
  ): Promise<void>;
  recordLoginSuccess(client: PoolClient, userId: string, now: Date): Promise<void>;
  getSourceRateLimit(
    client: PoolClient,
    sourceDigest: Buffer,
  ): Promise<AuthSourceRateLimitRecord | null>;
  saveSourceRateLimit(client: PoolClient, record: AuthSourceRateLimitRecord): Promise<void>;
  createSession(client: PoolClient, input: CreateSessionInput): Promise<AuthSessionRecord>;
  findSessionByTokenHash(
    client: PoolClient,
    tokenHash: Buffer,
  ): Promise<(AuthSessionRecord & { user: AuthUserRecord }) | null>;
  sessionHasCsrfDigest(
    client: PoolClient,
    sessionId: string,
    userId: string,
    csrfTokenHash: Buffer,
  ): Promise<boolean>;
  touchSession(client: PoolClient, sessionId: string, lastSeenAt: Date): Promise<void>;
  updatePassword(
    client: PoolClient,
    userId: string,
    passwordHash: string,
    now: Date,
  ): Promise<void>;
  revokeSession(client: PoolClient, sessionId: string, now: Date): Promise<number>;
  revokeOtherSessions(
    client: PoolClient,
    userId: string,
    retainedSessionId: string,
    now: Date,
  ): Promise<number>;
  revokeAllSessions(client: PoolClient, userId: string, now: Date): Promise<number>;
}

type UserRow = {
  id: string;
  username: string;
  normalized_username: string;
  password_hash: string;
  must_change_password: boolean;
  enabled: boolean;
  failed_login_count: number;
  locked_until: Date | null;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function mapUser(row: UserRow): AuthUserRecord {
  return {
    id: row.id,
    username: row.username,
    normalizedUsername: row.normalized_username,
    passwordHash: row.password_hash,
    mustChangePassword: row.must_change_password,
    enabled: row.enabled,
    failedLoginCount: row.failed_login_count,
    lockedUntil: row.locked_until,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PostgresAuthRepository implements AuthRepository {
  constructor(private readonly pool: Pool) {}

  async withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
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

  async findUserByUsername(client: PoolClient, username: string): Promise<AuthUserRecord | null> {
    const result = await client.query<UserRow>(
      `select id, username, normalized_username, password_hash, must_change_password,
              enabled, failed_login_count, locked_until, last_login_at, created_at, updated_at
       from users
       where normalized_username = lower(btrim($1))
       for update`,
      [username],
    );
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async findUserById(client: PoolClient, userId: string): Promise<AuthUserRecord | null> {
    const result = await client.query<UserRow>(
      `select id, username, normalized_username, password_hash, must_change_password,
              enabled, failed_login_count, locked_until, last_login_at, created_at, updated_at
       from users where id = $1 for update`,
      [userId],
    );
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async setUserLoginFailure(
    client: PoolClient,
    userId: string,
    failedLoginCount: number,
    lockedUntil: Date | null,
    updatedAt: Date,
  ): Promise<void> {
    await client.query(
      `update users
       set failed_login_count = $2, locked_until = $3, updated_at = $4
       where id = $1`,
      [userId, failedLoginCount, lockedUntil, updatedAt],
    );
  }

  async recordLoginSuccess(client: PoolClient, userId: string, now: Date): Promise<void> {
    await client.query(
      `update users
       set failed_login_count = 0, locked_until = null, last_login_at = $2, updated_at = $2
       where id = $1`,
      [userId, now],
    );
  }

  async getSourceRateLimit(
    client: PoolClient,
    sourceDigest: Buffer,
  ): Promise<AuthSourceRateLimitRecord | null> {
    await client.query(
      `select pg_advisory_xact_lock(hashtextextended(encode($1::bytea, 'hex'), 0))`,
      [sourceDigest],
    );
    const result = await client.query<{
      source_digest: Buffer;
      failure_count: number;
      window_started_at: Date;
      blocked_until: Date | null;
      updated_at: Date;
    }>(
      `select source_digest, failure_count, window_started_at, blocked_until, updated_at
       from auth_rate_limits where source_digest = $1 for update`,
      [sourceDigest],
    );
    const row = result.rows[0];
    return row
      ? {
          sourceDigest: row.source_digest,
          failureCount: row.failure_count,
          windowStartedAt: row.window_started_at,
          blockedUntil: row.blocked_until,
          updatedAt: row.updated_at,
        }
      : null;
  }

  async saveSourceRateLimit(client: PoolClient, record: AuthSourceRateLimitRecord): Promise<void> {
    await client.query(
      `insert into auth_rate_limits (
         source_digest, failure_count, window_started_at, blocked_until, updated_at
       ) values ($1, $2, $3, $4, $5)
       on conflict (source_digest) do update
       set failure_count = excluded.failure_count,
           window_started_at = excluded.window_started_at,
           blocked_until = excluded.blocked_until,
           updated_at = excluded.updated_at`,
      [
        record.sourceDigest,
        record.failureCount,
        record.windowStartedAt,
        record.blockedUntil,
        record.updatedAt,
      ],
    );
  }

  async createSession(client: PoolClient, input: CreateSessionInput): Promise<AuthSessionRecord> {
    const result = await client.query<{
      id: string;
      user_id: string;
      token_hash: Buffer;
      csrf_token_hash: Buffer;
      created_at: Date;
      last_seen_at: Date;
      absolute_expires_at: Date;
      revoked_at: Date | null;
    }>(
      `insert into web_sessions (
         user_id, token_hash, csrf_token_hash, created_at, last_seen_at, absolute_expires_at
       ) values ($1, $2, $3, $4, $5, $6)
       returning id, user_id, token_hash, csrf_token_hash, created_at, last_seen_at,
                 absolute_expires_at, revoked_at`,
      [
        input.userId,
        input.tokenHash,
        input.csrfTokenHash,
        input.createdAt,
        input.lastSeenAt,
        input.absoluteExpiresAt,
      ],
    );
    const row = result.rows[0]!;
    return {
      id: row.id,
      userId: row.user_id,
      tokenHash: row.token_hash,
      csrfTokenHash: row.csrf_token_hash,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      absoluteExpiresAt: row.absolute_expires_at,
      revokedAt: row.revoked_at,
    };
  }

  async findSessionByTokenHash(
    client: PoolClient,
    tokenHash: Buffer,
  ): Promise<(AuthSessionRecord & { user: AuthUserRecord }) | null> {
    const result = await client.query<
      UserRow & {
        session_id: string;
        user_id: string;
        token_hash: Buffer;
        csrf_token_hash: Buffer;
        session_created_at: Date;
        last_seen_at: Date;
        absolute_expires_at: Date;
        revoked_at: Date | null;
      }
    >(
      `select s.id as session_id, s.user_id, s.token_hash, s.csrf_token_hash,
              s.created_at as session_created_at, s.last_seen_at, s.absolute_expires_at,
              s.revoked_at, u.id, u.username, u.normalized_username, u.password_hash,
              u.must_change_password, u.enabled, u.failed_login_count, u.locked_until,
              u.last_login_at, u.created_at, u.updated_at
       from web_sessions s
       join users u on u.id = s.user_id
       where s.token_hash = $1
       for update of s`,
      [tokenHash],
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.session_id,
          userId: row.user_id,
          tokenHash: row.token_hash,
          csrfTokenHash: row.csrf_token_hash,
          createdAt: row.session_created_at,
          lastSeenAt: row.last_seen_at,
          absoluteExpiresAt: row.absolute_expires_at,
          revokedAt: row.revoked_at,
          user: mapUser(row),
        }
      : null;
  }

  async sessionHasCsrfDigest(
    client: PoolClient,
    sessionId: string,
    userId: string,
    csrfTokenHash: Buffer,
  ): Promise<boolean> {
    const result = await client.query<{ matches: boolean }>(
      `select exists (
         select 1 from web_sessions
         where id = $1 and user_id = $2 and csrf_token_hash = $3 and revoked_at is null
       ) as matches`,
      [sessionId, userId, csrfTokenHash],
    );
    return result.rows[0]?.matches ?? false;
  }

  async touchSession(client: PoolClient, sessionId: string, lastSeenAt: Date): Promise<void> {
    await client.query(`update web_sessions set last_seen_at = $2 where id = $1`, [
      sessionId,
      lastSeenAt,
    ]);
  }

  async updatePassword(
    client: PoolClient,
    userId: string,
    passwordHash: string,
    now: Date,
  ): Promise<void> {
    await client.query(
      `update users
       set password_hash = $2, must_change_password = false,
           failed_login_count = 0, locked_until = null, updated_at = $3
       where id = $1`,
      [userId, passwordHash, now],
    );
  }

  async revokeSession(client: PoolClient, sessionId: string, now: Date): Promise<number> {
    const result = await client.query(
      `update web_sessions set revoked_at = $2 where id = $1 and revoked_at is null`,
      [sessionId, now],
    );
    return result.rowCount ?? 0;
  }

  async revokeOtherSessions(
    client: PoolClient,
    userId: string,
    retainedSessionId: string,
    now: Date,
  ): Promise<number> {
    const result = await client.query(
      `update web_sessions set revoked_at = $3
       where user_id = $1 and id <> $2 and revoked_at is null`,
      [userId, retainedSessionId, now],
    );
    return result.rowCount ?? 0;
  }

  async revokeAllSessions(client: PoolClient, userId: string, now: Date): Promise<number> {
    const result = await client.query(
      `update web_sessions set revoked_at = $2 where user_id = $1 and revoked_at is null`,
      [userId, now],
    );
    return result.rowCount ?? 0;
  }
}
