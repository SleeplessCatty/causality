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

async function createPreMaintenanceMigrationsFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'causality-pre-maintenance-migrations-'));
  await mkdir(join(folder, 'meta'));
  const journal = JSON.parse(
    await readFile(join(migrationsFolder, 'meta/_journal.json'), 'utf8'),
  ) as { entries: Array<{ idx: number; tag: string }> };

  for (let index = 0; index <= 6; index += 1) {
    const migration = journal.entries[index]!;
    await cp(join(migrationsFolder, `${migration.tag}.sql`), join(folder, `${migration.tag}.sql`));
  }

  journal.entries = journal.entries.filter((entry) => entry.idx <= 6);
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
  let preMaintenanceMigrationsFolder: string | undefined;

  beforeAll(async () => {
    context = await startPostgresTestContext('causality_core_model_test');
    ({ pool } = context);
    legacyMigrationsFolder = await createLegacyMigrationsFolder();
    preMaintenanceMigrationsFolder = await createPreMaintenanceMigrationsFolder();
  }, 120_000);

  afterAll(async () => {
    await context?.close();
    if (legacyMigrationsFolder) await rm(legacyMigrationsFolder, { recursive: true });
    if (preMaintenanceMigrationsFolder) {
      await rm(preMaintenanceMigrationsFolder, { recursive: true });
    }
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
        'data_check_issues',
        'data_check_state',
        'event_aliases',
        'event_keywords',
        'semantic_embeddings',
        'semantic_index_state',
        'semantic_jobs',
        'semantic_model_settings',
      ]);

      const state = await migrationPool.query(
        `select singleton_key, status, last_snapshot_id
         from data_check_state`,
      );
      expect(state.rows).toEqual([
        {
          singleton_key: true,
          status: 'never_run',
          last_snapshot_id: null,
        },
      ]);
    } finally {
      await closePostgresTestPool(migrationPool);
    }
  });

  it('adds maintenance state without changing existing business records', async () => {
    const migrationDatabase = 'causality_data_maintenance_migration_test';
    await pool!.query(`create database ${migrationDatabase}`);
    const migrationPool = createPostgresTestPool(migrationDatabase);

    try {
      await migrate(createDatabaseClient(migrationPool), {
        migrationsFolder: preMaintenanceMigrationsFolder!,
      });
      await migrationPool.query(
        `insert into abstract_events (id, name)
         values
           ('91000000-0000-4000-8000-000000000001', 'Maintenance cause'),
           ('91000000-0000-4000-8000-000000000002', 'Maintenance effect');
         insert into event_aliases (event_id, alias)
         values ('91000000-0000-4000-8000-000000000001', 'Maintenance alias');
         insert into event_keywords (event_id, keyword, position)
         values ('91000000-0000-4000-8000-000000000001', 'Maintenance keyword', 1);
         insert into causal_relations
           (id, cause_event_id, effect_event_id, confidence)
         values (
           '92000000-0000-4000-8000-000000000001',
           '91000000-0000-4000-8000-000000000001',
           '91000000-0000-4000-8000-000000000002',
           50
         );
         insert into concrete_cases (id, content)
         values ('93000000-0000-4000-8000-000000000001', 'Maintenance concrete case');
         insert into causal_relation_cases (causal_relation_id, concrete_case_id)
         values (
           '92000000-0000-4000-8000-000000000001',
           '93000000-0000-4000-8000-000000000001'
         )`,
      );

      const before = await migrationPool.query<{
        events: string;
        aliases: string;
        keywords: string;
        relations: string;
        cases: string;
        relation_cases: string;
      }>(
        `select
           (select count(*) from abstract_events) as events,
           (select count(*) from event_aliases) as aliases,
           (select count(*) from event_keywords) as keywords,
           (select count(*) from causal_relations) as relations,
           (select count(*) from concrete_cases) as cases,
           (select count(*) from causal_relation_cases) as relation_cases`,
      );

      await runMigrations(migrationPool);

      const after = await migrationPool.query<{
        events: string;
        aliases: string;
        keywords: string;
        relations: string;
        cases: string;
        relation_cases: string;
      }>(
        `select
           (select count(*) from abstract_events) as events,
           (select count(*) from event_aliases) as aliases,
           (select count(*) from event_keywords) as keywords,
           (select count(*) from causal_relations) as relations,
           (select count(*) from concrete_cases) as cases,
           (select count(*) from causal_relation_cases) as relation_cases`,
      );
      expect(after.rows[0]).toEqual(before.rows[0]);

      const state = await migrationPool.query(
        `select singleton_key, status, last_snapshot_id
         from data_check_state`,
      );
      expect(state.rows).toEqual([
        {
          singleton_key: true,
          status: 'never_run',
          last_snapshot_id: null,
        },
      ]);
      const issues = await migrationPool.query<{ count: string }>(
        `select count(*) from data_check_issues`,
      );
      expect(issues.rows[0]?.count).toBe('0');
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

  it('installs semantic storage, pinned defaults, and dimension-specific HNSW indexes', async () => {
    const extensions = await pool!.query<{ extname: string }>(
      `select extname
       from pg_extension`,
    );
    expect(extensions.rows.map((row) => row.extname)).toContain('vector');

    const tables = await pool!.query<{ table_name: string }>(
      `select table_name
       from information_schema.tables
       where table_schema = 'public'`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual(
      expect.arrayContaining([
        'semantic_model_settings',
        'semantic_index_state',
        'semantic_embeddings',
        'semantic_jobs',
      ]),
    );

    const models = await pool!.query<{ model_code: string; threshold: number }>(
      `select model_code, threshold
       from semantic_model_settings
       order by model_code`,
    );
    expect(models.rows).toEqual([
      expect.objectContaining({ model_code: 'bge-m3', threshold: 55 }),
      expect.objectContaining({ model_code: 'multilingual-e5-small', threshold: 70 }),
    ]);

    const indexState = await pool!.query<{
      active_model_code: string | null;
      singleton_key: boolean;
      state_version: number;
      status: string;
    }>(
      `select singleton_key, active_model_code, status, state_version
       from semantic_index_state`,
    );
    expect(indexState.rows).toEqual([
      expect.objectContaining({
        singleton_key: true,
        active_model_code: null,
        status: 'empty',
        state_version: 0,
      }),
    ]);

    const vectorIndexes = await pool!.query<{ indexname: string }>(
      `select indexname
       from pg_indexes
       where schemaname = 'public'
         and indexname like 'semantic_embeddings_%_hnsw_idx'
       order by indexname`,
    );
    expect(vectorIndexes.rows.map((row) => row.indexname)).toEqual([
      'semantic_embeddings_case_bge_hnsw_idx',
      'semantic_embeddings_case_e5_hnsw_idx',
      'semantic_embeddings_event_bge_hnsw_idx',
      'semantic_embeddings_event_e5_hnsw_idx',
      'semantic_embeddings_relation_bge_hnsw_idx',
      'semantic_embeddings_relation_e5_hnsw_idx',
    ]);
  });

  it('enforces consistent semantic download and job lifecycle timestamps', async () => {
    await expectPgError(
      pool!.query(
        `update semantic_model_settings
         set downloaded_at = clock_timestamp()
         where model_code = 'multilingual-e5-small'`,
      ),
      '23514',
    );
    await expectPgError(
      pool!.query(
        `insert into semantic_jobs (
           job_type,
           model_code,
           status,
           state_version,
           lease_owner,
           lease_expires_at
         )
         values (
           'download',
           'multilingual-e5-small',
           'running',
           0,
           'test-worker',
           clock_timestamp() + interval '1 minute'
         )`,
      ),
      '23514',
    );
  });

  it('transactionally invalidates and deduplicates incremental semantic jobs', async () => {
    const causeId = '10000000-0000-4000-8000-000000000070';
    const effectId = '10000000-0000-4000-8000-000000000071';
    const linkedRelationId = '20000000-0000-4000-8000-000000000070';

    await pool!.query(
      `update semantic_index_state
       set active_model_code = 'multilingual-e5-small',
           status = 'ready',
           state_version = 1`,
    );
    await pool!.query(
      `insert into abstract_events (id, name)
       values ($1, '政策收紧'), ($2, '融资成本上升')`,
      [causeId, effectId],
    );

    const insertedEventJobs = await pool!.query<{ entity_id: string }>(
      `select entity_id
       from semantic_jobs
       where job_type = 'incremental'
         and entity_type = 'event'
         and entity_id = $1
         and status = 'queued'`,
      [causeId],
    );
    expect(insertedEventJobs.rows).toHaveLength(1);

    await pool!.query(
      `insert into causal_relations
         (id, cause_event_id, effect_event_id, confidence)
       values ($1, $2, $3, 60)`,
      [linkedRelationId, causeId, effectId],
    );
    await pool!.query(`delete from semantic_jobs where job_type = 'incremental'`);

    await pool!.query(`update abstract_events set name = '货币政策收紧' where id = $1`, [causeId]);
    await pool!.query(`update abstract_events set name = '货币政策进一步收紧' where id = $1`, [
      causeId,
    ]);

    const refreshedJobs = await pool!.query<{ entity_id: string; entity_type: string }>(
      `select entity_type, entity_id
       from semantic_jobs
       where job_type = 'incremental'
         and status = 'queued'
         and (
           (entity_type = 'event' and entity_id = $1)
           or (entity_type = 'relation' and entity_id = $2)
         )
       order by entity_type`,
      [causeId, linkedRelationId],
    );
    expect(refreshedJobs.rows).toEqual([
      { entity_type: 'event', entity_id: causeId },
      { entity_type: 'relation', entity_id: linkedRelationId },
    ]);

    await pool!.query(`delete from semantic_jobs where job_type = 'incremental'`);
    await pool!.query(
      `insert into event_aliases (event_id, alias)
       values ($1, '紧缩政策')`,
      [causeId],
    );
    await pool!.query(
      `insert into event_keywords (event_id, keyword, position)
       values ($1, '货币紧缩', 1)`,
      [causeId],
    );
    const metadataJobs = await pool!.query<{ count: number }>(
      `select count(*)::int as count
       from semantic_jobs
       where job_type = 'incremental'
         and entity_type = 'event'
         and entity_id = $1
         and status = 'queued'`,
      [causeId],
    );
    expect(metadataJobs.rows[0]?.count).toBe(1);
  });

  it('keeps a leased incremental job recoverable while queuing newer source changes', async () => {
    const eventId = '10000000-0000-4000-8000-000000000073';
    await pool!.query(
      `update semantic_index_state
       set active_model_code = 'multilingual-e5-small',
           status = 'ready',
           state_version = 2`,
    );
    await pool!.query(`insert into abstract_events (id, name) values ($1, '初始语义事件')`, [
      eventId,
    ]);
    await pool!.query(
      `update semantic_jobs
       set status = 'running',
           attempts = 1,
           lease_owner = 'stopped-worker',
           lease_expires_at = clock_timestamp() + interval '1 minute',
           started_at = clock_timestamp()
       where job_type = 'incremental'
         and entity_type = 'event'
         and entity_id = $1
         and status = 'queued'`,
      [eventId],
    );

    await pool!.query(`update abstract_events set name = '更新后的语义事件' where id = $1`, [
      eventId,
    ]);

    const changed = await pool!.query<{ status: string }>(
      `select status
       from semantic_jobs
       where job_type = 'incremental'
         and entity_type = 'event'
         and entity_id = $1
       order by status`,
      [eventId],
    );
    expect(changed.rows).toEqual([{ status: 'queued' }, { status: 'running' }]);

    await pool!.query(`delete from abstract_events where id = $1`, [eventId]);
    const deleted = await pool!.query<{ status: string }>(
      `select status
       from semantic_jobs
       where job_type = 'incremental'
         and entity_type = 'event'
         and entity_id = $1`,
      [eventId],
    );
    expect(deleted.rows).toEqual([{ status: 'running' }]);
  });

  it('removes an entity vector and its queued job inside the deleting transaction', async () => {
    const orphanEventId = '10000000-0000-4000-8000-000000000072';
    await pool!.query(`insert into abstract_events (id, name) values ($1, '待删除语义事件')`, [
      orphanEventId,
    ]);
    await pool!.query(
      `insert into semantic_embeddings
         (entity_type, entity_id, model_code, source_hash, embedding)
       values (
         'event',
         $1,
         'multilingual-e5-small',
         repeat('a', 64),
         array_fill(0.1, array[384])::vector
       )`,
      [orphanEventId],
    );

    const client = await pool!.connect();
    try {
      await client.query('begin');
      await client.query(`delete from abstract_events where id = $1`, [orphanEventId]);

      const transactionState = await client.query<{ jobs: number; vectors: number }>(
        `select
           (select count(*)::int
            from semantic_jobs
            where job_type = 'incremental'
              and entity_type = 'event'
              and entity_id = $1
              and status = 'queued') as jobs,
           (select count(*)::int
            from semantic_embeddings
            where entity_type = 'event'
              and entity_id = $1) as vectors`,
        [orphanEventId],
      );
      expect(transactionState.rows[0]).toEqual({ jobs: 0, vectors: 0 });
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
});
