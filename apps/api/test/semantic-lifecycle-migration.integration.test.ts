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
const eventId = '10000000-0000-4000-8000-000000000001';
const modelCode = 'multilingual-e5-small';

interface BusinessCounts {
  events: string;
  relations: string;
  cases: string;
  relationCases: string;
}

async function createPreLifecycleMigrationsFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'causality-pre-lifecycle-migrations-'));
  await mkdir(join(folder, 'meta'));
  const journal = JSON.parse(
    await readFile(join(migrationsFolder, 'meta/_journal.json'), 'utf8'),
  ) as { entries: Array<{ idx: number; tag: string }> };

  for (const migration of journal.entries.filter((entry) => entry.idx <= 12)) {
    await cp(join(migrationsFolder, `${migration.tag}.sql`), join(folder, `${migration.tag}.sql`));
  }

  journal.entries = journal.entries.filter((entry) => entry.idx <= 12);
  await writeFile(join(folder, 'meta/_journal.json'), `${JSON.stringify(journal, null, 2)}\n`);
  return folder;
}

async function businessCounts(pool: Pool): Promise<BusinessCounts> {
  const result = await pool.query<BusinessCounts>(
    `select
       (select count(*) from abstract_events) as events,
       (select count(*) from causal_relations) as relations,
       (select count(*) from concrete_cases) as cases,
       (select count(*) from causal_relation_cases) as "relationCases"`,
  );
  return result.rows[0]!;
}

async function embeddingCount(pool: Pool): Promise<number> {
  const result = await pool.query<{ count: number }>(
    `select count(*)::int as count from semantic_embeddings`,
  );
  return result.rows[0]!.count;
}

async function createLegacyDatabase(
  adminPool: Pool,
  migrations: string,
  databaseName: string,
): Promise<Pool> {
  await adminPool.query(`create database "${databaseName}"`);
  const pool = createPostgresTestPool(databaseName);
  await migrate(createDatabaseClient(pool), { migrationsFolder: migrations });
  return pool;
}

describe.sequential('semantic lifecycle migration', () => {
  let adminPool: Pool | undefined;
  let preLifecycleMigrationsFolder: string | undefined;

  beforeAll(async () => {
    adminPool = createPostgresTestPool('postgres');
    preLifecycleMigrationsFolder = await createPreLifecycleMigrationsFolder();
  });

  afterAll(async () => {
    await closePostgresTestPool(adminPool!);
    if (preLifecycleMigrationsFolder) {
      await rm(preLifecycleMigrationsFolder, { recursive: true });
    }
  });

  it('preserves business data and vectors while normalizing current jobs', async () => {
    const pool = await createLegacyDatabase(
      adminPool!,
      preLifecycleMigrationsFolder!,
      'causality_semantic_lifecycle_migration_test',
    );

    try {
      await pool.query(
        `insert into abstract_events (id, name)
         values ($1, 'Legacy semantic event')`,
        [eventId],
      );
      await pool.query(
        `update semantic_model_settings
         set download_status = 'downloaded',
             downloaded_at = clock_timestamp()
         where model_code = $1`,
        [modelCode],
      );
      await pool.query(
        `update semantic_index_state
         set active_model_code = $1,
             status = 'ready',
             state_version = 5,
             processed_items = 1,
             total_items = 1,
             pending_items = 0`,
        [modelCode],
      );
      await pool.query(
        `insert into semantic_embeddings (
           entity_type, entity_id, model_code, source_hash, embedding
         )
         values (
           'event', $1, $2, repeat('a', 64),
           array_fill(0::real, array[384])::vector
         )`,
        [eventId, modelCode],
      );
      await pool.query(
        `insert into semantic_jobs (
           id, job_type, model_code, status, state_version,
           started_at, completed_at
         )
         values (
           '41000000-0000-4000-8000-000000000001',
           'full_index', $1, 'succeeded', 5,
           clock_timestamp() - interval '2 minutes',
           clock_timestamp() - interval '1 minute'
         )`,
        [modelCode],
      );
      await pool.query(
        `insert into semantic_jobs (
           id, job_type, model_code, entity_type, entity_id,
           status, state_version,
           attempts, lease_owner, lease_expires_at, started_at
         )
         values (
           '41000000-0000-4000-8000-000000000002',
           'incremental', $2, 'event', $1, 'running', 5,
           1, 'legacy-worker', clock_timestamp() + interval '1 minute',
           clock_timestamp() - interval '30 seconds'
         )`,
        [eventId, modelCode],
      );
      await pool.query(
        `insert into semantic_jobs (
           id, job_type, model_code, entity_type, entity_id,
           status, state_version
         )
         values (
           '41000000-0000-4000-8000-000000000003',
           'incremental', $2, 'event', $1,
           'queued', 4
         )`,
        [eventId, modelCode],
      );
      await pool.query(
        `insert into semantic_jobs (
           id, job_type, model_code, entity_type, entity_id,
           status, state_version, attempts, started_at, completed_at, error
         )
         values (
           '41000000-0000-4000-8000-000000000004',
           'incremental', $2, 'event', $1,
           'failed', 5, 3,
           clock_timestamp() - interval '2 minutes',
           clock_timestamp() - interval '1 minute',
           '旧增量失败'
         )`,
        [eventId, modelCode],
      );

      const beforeCounts = await businessCounts(pool);
      const beforeEmbeddingCount = await embeddingCount(pool);

      await runMigrations(pool);

      const state = await pool.query<{
        failed_items: number;
        failure_kind: string | null;
        failure_stage: string | null;
        processed_items: number;
        status: string;
        total_items: number;
      }>(
        `select status, processed_items, total_items, failed_items,
                failure_stage, failure_kind
         from semantic_index_state
         where singleton_key = true`,
      );
      expect(state.rows[0]).toMatchObject({
        status: 'incomplete',
        processed_items: 1,
        total_items: 1,
        failed_items: 1,
        failure_stage: 'incremental',
        failure_kind: 'manual',
      });
      expect(await businessCounts(pool)).toEqual(beforeCounts);
      expect(await embeddingCount(pool)).toBe(beforeEmbeddingCount);

      const model = await pool.query<{
        file_status: string;
        legacy_column_exists: boolean;
      }>(
        `select file_status,
                exists (
                  select 1
                  from information_schema.columns
                  where table_schema = 'public'
                    and table_name = 'semantic_model_settings'
                    and column_name = 'download_status'
                ) as legacy_column_exists
         from semantic_model_settings
         where model_code = $1`,
        [modelCode],
      );
      expect(model.rows).toEqual([{ file_status: 'downloaded', legacy_column_exists: false }]);

      const jobs = await pool.query<{
        failure_code: string | null;
        failure_kind: string | null;
        id: string;
        lease_expires_at: Date | null;
        lease_owner: string | null;
        phase: string;
        started_at: Date | null;
        status: string;
      }>(
        `select id, status, phase, lease_owner, lease_expires_at,
                started_at, failure_kind, failure_code
         from semantic_jobs
         order by id`,
      );
      expect(jobs.rows).toEqual([
        {
          id: '41000000-0000-4000-8000-000000000002',
          status: 'queued',
          phase: 'waiting',
          lease_owner: null,
          lease_expires_at: null,
          started_at: null,
          failure_kind: null,
          failure_code: null,
        },
        {
          id: '41000000-0000-4000-8000-000000000004',
          status: 'failed',
          phase: 'indexing',
          lease_owner: null,
          lease_expires_at: null,
          started_at: expect.any(Date),
          failure_kind: 'manual',
          failure_code: 'LEGACY_INCREMENTAL_FAILURE',
        },
      ]);
    } finally {
      await closePostgresTestPool(pool);
    }
  });

  it('retains only the newest current high-level failure', async () => {
    const pool = await createLegacyDatabase(
      adminPool!,
      preLifecycleMigrationsFolder!,
      'causality_semantic_lifecycle_failure_migration_test',
    );

    try {
      await pool.query(
        `update semantic_model_settings
         set download_status = 'downloaded',
             downloaded_at = clock_timestamp()
         where model_code = $1`,
        [modelCode],
      );
      await pool.query(
        `update semantic_index_state
         set active_model_code = $1,
             status = 'failed',
             state_version = 9,
             error = '旧全量索引失败'`,
        [modelCode],
      );
      await pool.query(
        `insert into semantic_jobs (
           id, job_type, model_code, status, state_version, attempts,
           created_at, started_at, completed_at, error
         )
         values
           (
             '42000000-0000-4000-8000-000000000001',
             'full_index', $1, 'failed', 9, 3,
             clock_timestamp() - interval '3 minutes',
             clock_timestamp() - interval '3 minutes',
             clock_timestamp() - interval '2 minutes',
             '较旧失败'
           ),
           (
             '42000000-0000-4000-8000-000000000002',
             'full_index', $1, 'failed', 9, 3,
             clock_timestamp() - interval '2 minutes',
             clock_timestamp() - interval '2 minutes',
             clock_timestamp() - interval '1 minute',
             '最新失败'
           )`,
        [modelCode],
      );

      await runMigrations(pool);

      const jobs = await pool.query<{
        failure_code: string | null;
        failure_kind: string | null;
        id: string;
        phase: string;
      }>(
        `select id, phase, failure_kind, failure_code
         from semantic_jobs
         where job_type in ('download', 'load', 'full_index')
           and status = 'failed'`,
      );
      expect(jobs.rows).toEqual([
        {
          id: '42000000-0000-4000-8000-000000000002',
          phase: 'indexing',
          failure_kind: 'manual',
          failure_code: 'LEGACY_FULL_INDEX_FAILURE',
        },
      ]);

      const state = await pool.query<{
        failure_code: string | null;
        failure_kind: string | null;
        failure_stage: string | null;
        status: string;
      }>(
        `select status, failure_stage, failure_kind, failure_code
         from semantic_index_state
         where singleton_key = true`,
      );
      expect(state.rows).toEqual([
        {
          status: 'failed',
          failure_stage: 'full_index',
          failure_kind: 'manual',
          failure_code: 'LEGACY_FULL_INDEX_FAILURE',
        },
      ]);
    } finally {
      await closePostgresTestPool(pool);
    }
  });
});
