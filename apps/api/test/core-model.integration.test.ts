import { Pool } from 'pg';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runMigrations } from '../src/database/migrate.js';

const eventOneId = '10000000-0000-4000-8000-000000000001';
const eventTwoId = '10000000-0000-4000-8000-000000000002';
const relationId = '20000000-0000-4000-8000-000000000001';
const caseId = '30000000-0000-4000-8000-000000000001';

async function expectPgError(operation: Promise<unknown>, expectedCode: string): Promise<void> {
  await expect(operation).rejects.toMatchObject({ code: expectedCode });
}

describe.sequential('core PostgreSQL model', () => {
  let container: StartedTestContainer | undefined;
  let pool: Pool | undefined;

  beforeAll(async () => {
    container = await new GenericContainer('postgres:18.4-alpine')
      .withEnvironment({
        POSTGRES_DB: 'causality_test',
        POSTGRES_USER: 'causality',
        POSTGRES_PASSWORD: 'causality',
      })
      .withExposedPorts(5432)
      .withHealthCheck({
        test: ['CMD-SHELL', 'pg_isready -U causality -d causality_test'],
        interval: 1_000,
        timeout: 3_000,
        retries: 30,
      })
      .withWaitStrategy(Wait.forHealthCheck())
      .withStartupTimeout(120_000)
      .start();

    pool = new Pool({
      connectionString: `postgresql://causality:causality@${container.getHost()}:${container.getMappedPort(5432)}/causality_test`,
    });
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it('migrates an empty database and can be run again', async () => {
    await runMigrations(pool!);
    await runMigrations(pool!);

    const tables = await pool!.query<{ table_name: string }>(
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
    ]);
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

  it('keeps cases independent, unique, short, and reusable through relation links', async () => {
    await expectPgError(
      pool!.query(`insert into concrete_cases (content) values ('   ')`),
      '23514',
    );
    await expectPgError(
      pool!.query(`insert into concrete_cases (content) values ($1)`, ['事'.repeat(51)]),
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
        'abstract_events_normalized_name_trgm_idx',
        'abstract_events_updated_at_id_idx',
        'causal_relations_cause_event_id_idx',
        'causal_relations_effect_event_id_idx',
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
  });
});
