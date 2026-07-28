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
const databaseName = 'causality_relation_confidence_migration_test';
const causeEventId = '10000000-0000-4000-8000-000000000071';
const effectEventId = '10000000-0000-4000-8000-000000000072';
const relationId = '20000000-0000-4000-8000-000000000073';
const caseOneId = '30000000-0000-4000-8000-000000000074';
const caseTwoId = '30000000-0000-4000-8000-000000000075';
const directCauseEventId = '10000000-0000-4000-8000-000000000076';
const directEffectEventId = '10000000-0000-4000-8000-000000000077';
const directRelationId = '20000000-0000-4000-8000-000000000078';
const directCaseId = '30000000-0000-4000-8000-000000000079';

async function createPreConfidenceMigrationsFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'causality-pre-confidence-migrations-'));
  await mkdir(join(folder, 'meta'));
  const journal = JSON.parse(
    await readFile(join(migrationsFolder, 'meta/_journal.json'), 'utf8'),
  ) as { entries: Array<{ idx: number; tag: string }> };
  const entries = journal.entries.filter((entry) => entry.idx <= 15);

  for (const migration of entries) {
    await cp(join(migrationsFolder, `${migration.tag}.sql`), join(folder, `${migration.tag}.sql`));
  }

  journal.entries = entries;
  await writeFile(join(folder, 'meta/_journal.json'), `${JSON.stringify(journal, null, 2)}\n`);
  return folder;
}

async function expectCheckViolation(operation: Promise<unknown>): Promise<void> {
  await expect(operation).rejects.toMatchObject({ code: '23514' });
}

describe.sequential('relation confidence baseline migration', () => {
  let adminPool: Pool | undefined;
  let legacyPool: Pool | undefined;
  let preConfidenceMigrationsFolder: string | undefined;

  beforeAll(async () => {
    adminPool = createPostgresTestPool('postgres');
    preConfidenceMigrationsFolder = await createPreConfidenceMigrationsFolder();
    await adminPool.query(`create database "${databaseName}"`);
    legacyPool = createPostgresTestPool(databaseName);
    await migrate(createDatabaseClient(legacyPool), {
      migrationsFolder: preConfidenceMigrationsFolder,
    });

    await legacyPool.query(
      `insert into abstract_events (id, name)
       values ($1, '迁移前原因事件'), ($2, '迁移前结果事件')`,
      [causeEventId, effectEventId],
    );
    await legacyPool.query(
      `insert into causal_relations (
         id, cause_event_id, effect_event_id, confidence, description
       )
       values ($1, $2, $3, 73, '迁移前关系')`,
      [relationId, causeEventId, effectEventId],
    );
    await legacyPool.query(
      `insert into concrete_cases (id, content)
       values ($1, '迁移前具体案例一'), ($2, '迁移前具体案例二')`,
      [caseOneId, caseTwoId],
    );
    await legacyPool.query(
      `insert into causal_relation_cases (causal_relation_id, concrete_case_id)
       values ($1, $2), ($1, $3)`,
      [relationId, caseOneId, caseTwoId],
    );
  }, 120_000);

  afterAll(async () => {
    await closePostgresTestPool(legacyPool!);
    await closePostgresTestPool(adminPool!);
    if (preConfidenceMigrationsFolder) {
      await rm(preConfidenceMigrationsFolder, { recursive: true });
    }
  });

  it('preserves confidence and snapshots the linked case count', async () => {
    await runMigrations(legacyPool!);
    await runMigrations(legacyPool!);

    const columns = await legacyPool!.query<{ column_name: string }>(
      `select column_name
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'causal_relations'
         and column_name in ('baseline_confidence', 'baseline_case_count')
       order by column_name`,
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      'baseline_case_count',
      'baseline_confidence',
    ]);

    const migrated = await legacyPool!.query<{
      baseline_case_count: number;
      baseline_confidence: string;
      confidence: string;
    }>(
      `select confidence, baseline_confidence, baseline_case_count
       from causal_relations
       where id = $1`,
      [relationId],
    );
    expect(migrated.rows[0]).toEqual({
      confidence: '73.0000',
      baseline_confidence: '73.0000',
      baseline_case_count: 2,
    });
  });

  it('rejects invalid confidence baselines', async () => {
    await expectCheckViolation(
      legacyPool!.query(`update causal_relations set baseline_case_count = -1 where id = $1`, [
        relationId,
      ]),
    );
    await expectCheckViolation(
      legacyPool!.query(
        `update causal_relations set baseline_confidence = 100.0001 where id = $1`,
        [relationId],
      ),
    );
    await expectCheckViolation(
      legacyPool!.query(`update causal_relations set confidence = 100.0001 where id = $1`, [
        relationId,
      ]),
    );
  });

  it('keeps direct relation and link writers valid under the final policy', async () => {
    await legacyPool!.query(
      `insert into abstract_events (id, name)
       values ($1, '直接写入原因事件'), ($2, '直接写入结果事件')`,
      [directCauseEventId, directEffectEventId],
    );
    await legacyPool!.query(
      `insert into causal_relations (
         id, cause_event_id, effect_event_id, confidence, description
       )
       values ($1, $2, $3, 41.2500, '直接写入关系')`,
      [directRelationId, directCauseEventId, directEffectEventId],
    );
    await legacyPool!.query(
      `insert into concrete_cases (id, content)
       values ($1, '直接写入关系的具体案例')`,
      [directCaseId],
    );
    await legacyPool!.query(
      `insert into causal_relation_cases (causal_relation_id, concrete_case_id)
       values ($1, $2)`,
      [directRelationId, directCaseId],
    );

    const stored = await legacyPool!.query<{
      baseline_case_count: number;
      baseline_confidence: string;
      confidence: string;
    }>(
      `select confidence, baseline_confidence, baseline_case_count
       from causal_relations
       where id = $1`,
      [directRelationId],
    );
    expect(stored.rows[0]).toEqual({
      confidence: '47.1250',
      baseline_confidence: '41.2500',
      baseline_case_count: 0,
    });
  });
});
