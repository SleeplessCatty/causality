import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient } from '../src/database/client.js';
import { runMigrations } from '../src/database/migrate.js';
import {
  closePostgresTestPool,
  createPostgresTestPool,
  startPostgresTestContext,
} from './support/postgresTestContext.js';

const eventOneId = '10000000-0000-4000-8000-000000000001';
const eventTwoId = '10000000-0000-4000-8000-000000000002';
const relationId = '20000000-0000-4000-8000-000000000001';
const caseId = '30000000-0000-4000-8000-000000000001';
const legacyEventId = '10000000-0000-4000-8000-000000000090';

const migrationsFolder = fileURLToPath(new URL('../../../database/migrations', import.meta.url));

async function createLegacyMigrationsFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'causality-legacy-migrations-'));
  await mkdir(join(folder, 'meta'));
  const journal = JSON.parse(
    await readFile(join(migrationsFolder, 'meta/_journal.json'), 'utf8'),
  ) as { entries: Array<{ idx: number; tag: string }> };

  for (let index = 0; index <= 4; index += 1) {
    const migration = journal.entries[index]!;
    await cp(join(migrationsFolder, `${migration.tag}.sql`), join(folder, `${migration.tag}.sql`));
  }

  journal.entries = journal.entries.filter((entry) => entry.idx <= 4);
  await writeFile(join(folder, 'meta/_journal.json'), `${JSON.stringify(journal, null, 2)}\n`);
  return folder;
}

async function expectPgError(operation: Promise<unknown>, expectedCode: string): Promise<void> {
  await expect(operation).rejects.toMatchObject({ code: expectedCode });
}

describe.sequential('core PostgreSQL model', () => {
  let context: Awaited<ReturnType<typeof startPostgresTestContext>> | undefined;
  let pool: Pool | undefined;
  let legacyMigrationsFolder: string | undefined;

  beforeAll(async () => {
    context = await startPostgresTestContext('causality_core_model_test');
    ({ pool } = context);
    legacyMigrationsFolder = await createLegacyMigrationsFolder();
  }, 120_000);

  afterAll(async () => {
    await context?.close();
    if (legacyMigrationsFolder) await rm(legacyMigrationsFolder, { recursive: true });
  });

  it('losslessly migrates ordered keyword arrays and can be run again', async () => {
    const migrationDatabase = 'causality_keyword_migration_test';
    await pool!.query(`create database ${migrationDatabase}`);
    const migrationPool = createPostgresTestPool(migrationDatabase);

    try {
      await migrate(createDatabaseClient(migrationPool), {
        migrationsFolder: legacyMigrationsFolder!,
      });
      await migrationPool.query(
        `insert into abstract_events (id, name, keywords)
       values ($1, 'Legacy keyword event', $2::text[])`,
        [legacyEventId, ['First Tag', '第二词', ' spaced ']],
      );

      await runMigrations(migrationPool);
      await runMigrations(migrationPool);

      const keywordTable = await migrationPool.query<{ name: string | null }>(
        `select to_regclass('public.event_keywords')::text as name`,
      );
      expect(keywordTable.rows[0]?.name).toBe('event_keywords');

      const keywords = await migrationPool.query<{ keyword: string; position: number }>(
        `select keyword, position
       from event_keywords
       where event_id = $1
       order by position`,
        [legacyEventId],
      );
      expect(keywords.rows).toEqual([
        { keyword: 'First Tag', position: 1 },
        { keyword: '第二词', position: 2 },
        { keyword: ' spaced ', position: 3 },
      ]);

      const legacyColumn = await migrationPool.query<{ exists: boolean }>(
        `select exists (
         select 1
         from information_schema.columns
         where table_schema = 'public'
           and table_name = 'abstract_events'
           and column_name = 'keywords'
       ) as exists`,
      );
      expect(legacyColumn.rows[0]?.exists).toBe(false);

      const tables = await migrationPool.query<{ table_name: string }>(
        `select table_name
       from information_schema.tables
       where table_schema = 'public'
       order by table_name`,
      );

      expect(tables.rows.map((row) => row.table_name)).toEqual([
        'abstract_events',
        'causal_relation_cases',
        'causal_relations',
        'concrete_cases',
        'event_aliases',
        'event_keywords',
      ]);
    } finally {
      await closePostgresTestPool(migrationPool);
    }
  });

  it('rolls the whole migration back when legacy keywords cannot be copied', async () => {
    const rollbackDatabase = 'causality_keyword_rollback_test';
    await pool!.query(`create database ${rollbackDatabase}`);
    const rollbackPool = createPostgresTestPool(rollbackDatabase);

    try {
      await migrate(createDatabaseClient(rollbackPool), {
        migrationsFolder: legacyMigrationsFolder!,
      });
      await rollbackPool.query(
        `insert into abstract_events (name, keywords)
         values ('Invalid legacy keyword event', array['Rate Hike', ' rate hike '])`,
      );

      await expect(runMigrations(rollbackPool)).rejects.toMatchObject({
        cause: { code: '23505' },
      });

      const state = await rollbackPool.query<{
        keyword_column_exists: boolean;
        keyword_table_exists: boolean;
      }>(
        `select
           exists (
             select 1 from information_schema.columns
             where table_schema = 'public'
               and table_name = 'abstract_events'
               and column_name = 'keywords'
           ) as keyword_column_exists,
           to_regclass('public.event_keywords') is not null as keyword_table_exists`,
      );
      expect(state.rows[0]).toEqual({
        keyword_column_exists: true,
        keyword_table_exists: false,
      });
    } finally {
      await closePostgresTestPool(rollbackPool);
    }
  });

  it('enforces normalized event names and aliases', async () => {
    await pool!.query(
      `insert into abstract_events (id, name)
       values ($1, '  Interest Rate Rises  '), ($2, 'Liquidity Tightens')`,
      [eventOneId, eventTwoId],
    );

    const normalized = await pool!.query<{ normalized_name: string }>(
      'select normalized_name from abstract_events where id = $1',
      [eventOneId],
    );
    expect(normalized.rows[0]?.normalized_name).toBe('interest rate rises');

    await expectPgError(
      pool!.query(`insert into abstract_events (name) values ('interest rate rises')`),
      '23505',
    );

    await pool!.query(`insert into event_aliases (event_id, alias) values ($1, '  Rate Hike  ')`, [
      eventOneId,
    ]);
    await expectPgError(
      pool!.query(`insert into event_aliases (event_id, alias) values ($1, 'rate hike')`, [
        eventOneId,
      ]),
      '23505',
    );

    await expect(
      pool!.query(`insert into event_aliases (event_id, alias) values ($1, 'rate hike')`, [
        eventTwoId,
      ]),
    ).resolves.toBeTruthy();
  });

  it('enforces 50/80/50 event field boundaries in PostgreSQL', async () => {
    const boundaryEventId = '10000000-0000-4000-8000-000000000010';
    await expect(
      pool!.query(`insert into abstract_events (id, name) values ($1, $2)`, [
        boundaryEventId,
        '事'.repeat(50),
      ]),
    ).resolves.toBeTruthy();
    await expectPgError(
      pool!.query(`insert into abstract_events (name) values ($1)`, ['事'.repeat(51)]),
      '22001',
    );
    await expect(
      pool!.query(`insert into event_aliases (event_id, alias) values ($1, $2)`, [
        boundaryEventId,
        '别'.repeat(80),
      ]),
    ).resolves.toBeTruthy();
    await expectPgError(
      pool!.query(`insert into event_aliases (event_id, alias) values ($1, $2)`, [
        boundaryEventId,
        '别'.repeat(81),
      ]),
      '22001',
    );
    await expect(
      pool!.query(`insert into event_keywords (event_id, keyword, position) values ($1, $2, 1)`, [
        boundaryEventId,
        '词'.repeat(50),
      ]),
    ).resolves.toBeTruthy();
    await expectPgError(
      pool!.query(
        `insert into event_keywords (event_id, keyword, position) values ($1, '   ', 2)`,
        [boundaryEventId],
      ),
      '23514',
    );
    await expectPgError(
      pool!.query(`insert into event_keywords (event_id, keyword, position) values ($1, $2, 2)`, [
        boundaryEventId,
        '词'.repeat(51),
      ]),
      '22001',
    );
    await pool!.query(
      `insert into event_keywords (event_id, keyword, position)
       values ($1, '  Mixed Tag  ', 2)`,
      [boundaryEventId],
    );
    await expectPgError(
      pool!.query(
        `insert into event_keywords (event_id, keyword, position)
         values ($1, 'mixed tag', 3)`,
        [boundaryEventId],
      ),
      '23505',
    );
    await expectPgError(
      pool!.query(
        `insert into event_keywords (event_id, keyword, position)
         values ($1, 'invalid zero position', 0)`,
        [boundaryEventId],
      ),
      '23514',
    );
    await expectPgError(
      pool!.query(
        `insert into event_keywords (event_id, keyword, position)
         values ($1, 'invalid twenty-first position', 21)`,
        [boundaryEventId],
      ),
      '23514',
    );
  });

  it('prevents self loops and duplicate directions but allows reverse relations', async () => {
    await expectPgError(
      pool!.query(
        `insert into causal_relations
           (cause_event_id, effect_event_id, confidence)
         values ($1, $1, 50)`,
        [eventOneId],
      ),
      '23514',
    );

    await pool!.query(
      `insert into causal_relations
         (id, cause_event_id, effect_event_id, confidence)
       values ($1, $2, $3, 70)`,
      [relationId, eventOneId, eventTwoId],
    );

    await expectPgError(
      pool!.query(
        `insert into causal_relations
           (cause_event_id, effect_event_id, confidence)
         values ($1, $2, 80)`,
        [eventOneId, eventTwoId],
      ),
      '23505',
    );

    await expect(
      pool!.query(
        `insert into causal_relations
           (cause_event_id, effect_event_id, confidence)
         values ($1, $2, 30)`,
        [eventTwoId, eventOneId],
      ),
    ).resolves.toBeTruthy();
  });

  it('accepts confidence boundaries and rejects values outside them', async () => {
    const eventThree = '10000000-0000-4000-8000-000000000003';
    const eventFour = '10000000-0000-4000-8000-000000000004';
    await pool!.query(
      `insert into abstract_events (id, name)
       values ($1, 'Event Three'), ($2, 'Event Four')`,
      [eventThree, eventFour],
    );

    await expect(
      pool!.query(
        `insert into causal_relations
           (cause_event_id, effect_event_id, confidence)
         values ($1, $2, 0), ($2, $1, 100)`,
        [eventThree, eventFour],
      ),
    ).resolves.toBeTruthy();

    await expectPgError(
      pool!.query(
        `insert into causal_relations
           (cause_event_id, effect_event_id, confidence)
         values ($1, $2, -1)`,
        [eventOneId, eventThree],
      ),
      '23514',
    );
    await expectPgError(
      pool!.query(
        `insert into causal_relations
           (cause_event_id, effect_event_id, confidence)
         values ($1, $2, 101)`,
        [eventOneId, eventFour],
      ),
      '23514',
    );
  });

  it('keeps cases independent, unique, bounded, and reusable through relation links', async () => {
    await expectPgError(
      pool!.query(`insert into concrete_cases (content) values ('   ')`),
      '23514',
    );
    await expect(
      pool!.query(`insert into concrete_cases (content) values ($1)`, ['事'.repeat(100)]),
    ).resolves.toBeTruthy();
    await expectPgError(
      pool!.query(`insert into concrete_cases (content) values ($1)`, ['事'.repeat(101)]),
      '22001',
    );
    await pool!.query(`insert into concrete_cases (id, content) values ($1, $2)`, [
      caseId,
      '2025年4月美国宣布新一轮关税措施',
    ]);
    await expectPgError(
      pool!.query(`insert into concrete_cases (content) values ($1)`, [
        '2025年4月美国宣布新一轮关税措施',
      ]),
      '23505',
    );
    await expectPgError(
      pool!.query(
        `insert into causal_relation_cases (causal_relation_id, concrete_case_id)
         values ('ffffffff-ffff-4fff-8fff-ffffffffffff', $1)`,
        [caseId],
      ),
      '23503',
    );
    await pool!.query(
      `insert into causal_relation_cases (causal_relation_id, concrete_case_id)
       values ($1, $2)`,
      [relationId, caseId],
    );
    await expectPgError(
      pool!.query(
        `insert into causal_relation_cases (causal_relation_id, concrete_case_id)
         values ($1, $2)`,
        [relationId, caseId],
      ),
      '23505',
    );
  });

  it('protects referenced events and relations while cascading aliases', async () => {
    await expectPgError(
      pool!.query('delete from abstract_events where id = $1', [eventOneId]),
      '23001',
    );
    await expectPgError(
      pool!.query('delete from causal_relations where id = $1', [relationId]),
      '23001',
    );

    const unusedEvent = '10000000-0000-4000-8000-000000000099';
    await pool!.query(`insert into abstract_events (id, name) values ($1, 'Unused Event')`, [
      unusedEvent,
    ]);
    await pool!.query(`insert into event_aliases (event_id, alias) values ($1, 'Unused Alias')`, [
      unusedEvent,
    ]);
    await pool!.query('delete from abstract_events where id = $1', [unusedEvent]);

    const aliases = await pool!.query<{ count: string }>(
      'select count(*) from event_aliases where event_id = $1',
      [unusedEvent],
    );
    expect(aliases.rows[0]?.count).toBe('0');
  });

  it('creates indexes for foreign keys, directional queries, search, and pagination', async () => {
    const indexes = await pool!.query<{ indexname: string }>(
      `select indexname
       from pg_indexes
       where schemaname = 'public'`,
    );
    const names = indexes.rows.map((row) => row.indexname);

    expect(names).toEqual(
      expect.arrayContaining([
        'event_aliases_event_id_idx',
        'event_aliases_normalized_alias_idx',
        'event_aliases_normalized_alias_trgm_idx',
        'event_keywords_event_normalized_uidx',
        'event_keywords_event_position_uidx',
        'event_keywords_normalized_trgm_idx',
        'event_keywords_event_id_idx',
        'abstract_events_normalized_name_trgm_idx',
        'abstract_events_updated_at_id_idx',
        'causal_relations_cause_created_at_id_idx',
        'causal_relations_effect_created_at_id_idx',
        'causal_relations_description_trgm_idx',
        'causal_relations_updated_at_id_idx',
        'concrete_cases_content_trgm_idx',
        'concrete_cases_updated_at_id_idx',
        'causal_relation_cases_relation_linked_idx',
        'causal_relation_cases_case_linked_idx',
      ]),
    );

    const extension = await pool!.query<{ installed: boolean }>(
      `select exists (
         select 1 from pg_extension where extname = 'pg_trgm'
       ) as installed`,
    );
    expect(extension.rows[0]?.installed).toBe(true);

    const client = await pool!.connect();
    try {
      await client.query('begin');
      await client.query('set local enable_seqscan = off');
      const causePlan = await client.query<{ 'QUERY PLAN': string }>(
        `explain
         select id
         from causal_relations
         where cause_event_id = $1
         order by created_at desc, id desc
         limit 21`,
        [eventOneId],
      );
      const effectPlan = await client.query<{ 'QUERY PLAN': string }>(
        `explain
         select id
         from causal_relations
         where effect_event_id = $1
         order by created_at desc, id desc
         limit 21`,
        [eventTwoId],
      );
      expect(causePlan.rows.map((row) => row['QUERY PLAN']).join('\n')).toContain(
        'causal_relations_cause_created_at_id_idx',
      );
      expect(effectPlan.rows.map((row) => row['QUERY PLAN']).join('\n')).toContain(
        'causal_relations_effect_created_at_id_idx',
      );
      await client.query('rollback');
    } finally {
      client.release();
    }
  });
});
