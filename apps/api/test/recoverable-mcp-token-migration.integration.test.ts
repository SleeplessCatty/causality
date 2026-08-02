import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient } from '../src/database/client.js';
import { runMigrations } from '../src/database/migrate.js';
import { closePostgresTestPool, createPostgresTestPool } from './support/postgresTestContext.js';

const migrationsFolder = fileURLToPath(new URL('../../../database/migrations', import.meta.url));
const databaseName = 'causality_recoverable_mcp_token_migration_test';

async function createLegacyMigrationsFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'causality-pre-recoverable-mcp-token-'));
  await mkdir(join(folder, 'meta'));
  const journal = JSON.parse(
    await readFile(join(migrationsFolder, 'meta/_journal.json'), 'utf8'),
  ) as { entries: Array<{ idx: number; tag: string }> };
  const entries = journal.entries.filter((entry) => entry.idx <= 22);
  for (const migration of entries) {
    await cp(join(migrationsFolder, `${migration.tag}.sql`), join(folder, `${migration.tag}.sql`));
  }
  journal.entries = entries;
  await writeFile(join(folder, 'meta/_journal.json'), `${JSON.stringify(journal, null, 2)}\n`);
  return folder;
}

describe.sequential('recoverable MCP token migration', () => {
  let adminPool: Pool;
  let pool: Pool;
  let legacyMigrationsFolder: string;

  beforeAll(async () => {
    adminPool = createPostgresTestPool('postgres');
    legacyMigrationsFolder = await createLegacyMigrationsFolder();
    await adminPool.query(`create database "${databaseName}"`);
    pool = createPostgresTestPool(databaseName);
    await migrate(createDatabaseClient(pool), { migrationsFolder: legacyMigrationsFolder });
    const user = await pool.query<{ id: string }>(
      `insert into users (username, password_hash) values ('legacy-token-user', 'hash') returning id`,
    );
    await pool.query(
      `insert into mcp_access_tokens (user_id, token_digest, device_name)
       values ($1, decode(repeat('01', 32), 'hex'), 'Legacy token')`,
      [user.rows[0]!.id],
    );
  }, 120_000);

  afterAll(async () => {
    await closePostgresTestPool(pool);
    await closePostgresTestPool(adminPool);
    await rm(legacyMigrationsFolder, { recursive: true });
  });

  it('deletes digest-only tokens and installs the recoverable schema', async () => {
    await runMigrations(pool);
    await runMigrations(pool);

    const count = await pool.query<{ count: number }>(
      `select count(*)::int as count from mcp_access_tokens`,
    );
    expect(count.rows[0]?.count).toBe(0);

    const columns = await pool.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'mcp_access_tokens'
       order by ordinal_position`,
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      'id',
      'user_id',
      'token_digest',
      'name',
      'created_at',
      'last_used_at',
      'last_client_name',
      'masked_token',
      'token_ciphertext',
      'token_iv',
      'token_auth_tag',
    ]);
  });

  it('enforces user-scoped case-insensitive names and encrypted field lengths', async () => {
    const users = await pool.query<{ id: string }>(
      `insert into users (username, password_hash)
       values ('token-owner-a', 'hash'), ('token-owner-b', 'hash') returning id`,
    );
    const [userA, userB] = users.rows;
    const values = [
      Buffer.alloc(32, 1),
      'Codex',
      'cau_pat_aaaa••••wxyz',
      Buffer.from('ciphertext'),
      Buffer.alloc(12, 2),
      Buffer.alloc(16, 3),
    ];
    await pool.query(
      `insert into mcp_access_tokens
       (user_id, token_digest, name, masked_token, token_ciphertext, token_iv, token_auth_tag)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [userA!.id, ...values],
    );
    await expect(
      pool.query(
        `insert into mcp_access_tokens
         (user_id, token_digest, name, masked_token, token_ciphertext, token_iv, token_auth_tag)
         values ($1, $2, 'codex', $3, $4, $5, $6)`,
        [
          userA!.id,
          Buffer.alloc(32, 4),
          'cau_pat_bbbb••••wxyz',
          Buffer.from('ciphertext'),
          Buffer.alloc(12, 2),
          Buffer.alloc(16, 3),
        ],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      pool.query(
        `insert into mcp_access_tokens
         (user_id, token_digest, name, masked_token, token_ciphertext, token_iv, token_auth_tag)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [userB!.id, Buffer.alloc(32, 5), ...values.slice(1)],
      ),
    ).resolves.toBeTruthy();
    await expect(
      pool.query(
        `insert into mcp_access_tokens
         (user_id, token_digest, name, masked_token, token_ciphertext, token_iv, token_auth_tag)
         values ($1, $2, 'Bad cipher', $3, ''::bytea, $4, $5)`,
        [
          userA!.id,
          Buffer.alloc(32, 6),
          'cau_pat_cccc••••wxyz',
          Buffer.alloc(12, 2),
          Buffer.alloc(16, 3),
        ],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
