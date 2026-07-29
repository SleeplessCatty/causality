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
const databaseName = 'causality_ai_import_link_reuse_migration_test';
const planId = '10000000-0000-4000-8000-000000000021';
const batchId = '20000000-0000-4000-8000-000000000021';
const relationId = '30000000-0000-4000-8000-000000000021';
const caseId = '40000000-0000-4000-8000-000000000021';

async function createPreReuseMigrationsFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'causality-pre-ai-link-reuse-migrations-'));
  await mkdir(join(folder, 'meta'));
  const journal = JSON.parse(
    await readFile(join(migrationsFolder, 'meta/_journal.json'), 'utf8'),
  ) as { entries: Array<{ idx: number; tag: string }> };
  const entries = journal.entries.filter((entry) => entry.idx <= 19);

  for (const migration of entries) {
    await cp(join(migrationsFolder, `${migration.tag}.sql`), join(folder, `${migration.tag}.sql`));
  }
  journal.entries = entries;
  await writeFile(join(folder, 'meta/_journal.json'), `${JSON.stringify(journal, null, 2)}\n`);
  return folder;
}

describe.sequential('AI import relation-case reuse migration', () => {
  let adminPool: Pool;
  let legacyPool: Pool;
  let preReuseMigrationsFolder: string;

  beforeAll(async () => {
    adminPool = createPostgresTestPool('postgres');
    preReuseMigrationsFolder = await createPreReuseMigrationsFolder();
    await adminPool.query(`create database "${databaseName}"`);
    legacyPool = createPostgresTestPool(databaseName);
    await migrate(createDatabaseClient(legacyPool), {
      migrationsFolder: preReuseMigrationsFolder,
    });

    await legacyPool.query(
      `insert into ai_import_plans (
         id, version, status, topic, client_name,
         candidate_payload, plan_payload, result_payload,
         created_at, expires_at, committed_at
       )
       values (
         $1, 1, 'committed', '迁移前 AI 导入', 'migration-test',
         '{}'::jsonb, '{}'::jsonb,
         '{"counts":{"eventCreated":0,"eventReused":2,"eventUpdated":0,"caseCreated":0,"caseReused":1,"relationCreated":0,"relationReused":1,"relationCaseCreated":0,"confidenceChanged":0}}'::jsonb,
         '2026-07-29T10:00:00Z', '2026-07-29T10:30:00Z', '2026-07-29T10:10:00Z'
       )`,
      [planId],
    );
    await legacyPool.query(
      `insert into ai_import_batches (
         id, plan_id, topic, plan_version, client_name,
         event_created, event_reused, event_updated,
         case_created, case_reused,
         relation_created, relation_reused,
         relation_case_created, confidence_changed
       )
       values ($1, $2, '迁移前 AI 导入', 1, 'migration-test', 0, 2, 0, 0, 1, 0, 1, 0, 0)`,
      [batchId, planId],
    );
    await legacyPool.query(
      `insert into ai_import_records (
         batch_id, sequence, record_type, action,
         primary_record_id, related_record_id, detail
       )
       values ($1, 1, 'relation_case', 'reused', $2, $3, '{}'::jsonb)`,
      [batchId, relationId, caseId],
    );
  }, 120_000);

  afterAll(async () => {
    await closePostgresTestPool(legacyPool);
    await closePostgresTestPool(adminPool);
    await rm(preReuseMigrationsFolder, { recursive: true });
  });

  it('backfills the batch and stored commit result from reused history records', async () => {
    await runMigrations(legacyPool);
    await runMigrations(legacyPool);

    const migrated = await legacyPool.query<{
      relation_case_reused: number;
      result_reused: number;
    }>(
      `select batch.relation_case_reused,
              (plan.result_payload #>> '{counts,relationCaseReused}')::int as result_reused
       from ai_import_batches batch
       join ai_import_plans plan on plan.id = batch.plan_id
       where batch.id = $1`,
      [batchId],
    );

    expect(migrated.rows[0]).toEqual({ relation_case_reused: 1, result_reused: 1 });
  });
});
