import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startPostgresTestContext } from './support/postgresTestContext.js';

describe.sequential('cloud authentication foundation migration', () => {
  let context: Awaited<ReturnType<typeof startPostgresTestContext>>;
  let pool: Pool;

  beforeAll(async () => {
    context = await startPostgresTestContext('causality_cloud_auth_migration_test');
    ({ pool } = context);
  });

  afterAll(async () => {
    await context.close();
  });

  it('creates the authentication and audit tables without plaintext secret columns', async () => {
    const tables = await pool.query<{ table_name: string }>(
      `select table_name
       from information_schema.tables
       where table_schema = 'public'
         and table_name = any($1::text[])
       order by table_name`,
      [['audit_logs', 'auth_rate_limits', 'users', 'web_sessions']],
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      'audit_logs',
      'auth_rate_limits',
      'users',
      'web_sessions',
    ]);

    const forbiddenColumns = await pool.query<{ column_name: string }>(
      `select column_name
       from information_schema.columns
       where table_schema = 'public'
         and table_name = any($1::text[])
         and column_name = any($2::text[])`,
      [
        ['audit_logs', 'auth_rate_limits', 'users', 'web_sessions'],
        ['ip', 'ip_address', 'password', 'raw_ip', 'raw_session_token', 'session_token'],
      ],
    );
    expect(forbiddenColumns.rows).toEqual([]);
  });

  it('enforces case-insensitive usernames and non-null password hashes', async () => {
    await pool.query(
      `insert into users (username, password_hash)
       values ('Jason', 'encoded-hash')`,
    );

    await expect(
      pool.query(
        `insert into users (username, password_hash)
         values ('JASON', 'another-hash')`,
      ),
    ).rejects.toMatchObject({ code: '23505' });

    await expect(
      pool.query(`insert into users (username) values ('friend')`),
    ).rejects.toMatchObject({ code: '23502' });
  });

  it('keeps user references intact for active sessions and historical audit records', async () => {
    const created = await pool.query<{ id: string }>(
      `insert into users (username, password_hash)
       values ('audited-user', 'encoded-hash')
       returning id`,
    );
    const userId = created.rows[0]!.id;
    await pool.query(
      `insert into web_sessions (
         user_id, token_hash, csrf_token_hash, created_at, last_seen_at, absolute_expires_at
       ) values ($1, decode(repeat('01', 32), 'hex'), decode(repeat('02', 32), 'hex'), now(), now(), now() + interval '7 days')`,
      [userId],
    );
    await pool.query(
      `insert into audit_logs (
         actor_type, actor_user_id, actor_username, actor_channel, request_id,
         action, target_type, target_id, result, occurred_at
       ) values ('user', $1::uuid, 'audited-user', 'web', 'migration-test',
                 'auth.login_succeeded', 'user', $1::text, 'success', now())`,
      [userId],
    );

    await expect(pool.query(`delete from users where id = $1`, [userId])).rejects.toMatchObject({
      code: '23001',
    });
  });
});
