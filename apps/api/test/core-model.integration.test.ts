import { Pool } from 'pg';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runMigrations } from '../src/database/migrate.js';

const eventOneId = '10000000-0000-4000-8000-000000000001';
const eventTwoId = '10000000-0000-4000-8000-000000000002';
const relationId = '20000000-0000-4000-8000-000000000001';

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
      'causal_relations',
      'concrete_causal_cases',
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

  it('requires valid case references and chronological occurrence times', async () => {
    await expectPgError(
      pool!.query(
        `insert into concrete_causal_cases
           (causal_relation_id, cause_event, effect_event,
            cause_occurred_at, effect_occurred_at, description, source)
         values
           ($1, 'Cause', 'Effect', '2026-02-02', '2026-02-01',
            'Explanation', 'Public source')`,
        [relationId],
      ),
      '23514',
    );

    await expectPgError(
      pool!.query(
        `insert into concrete_causal_cases
           (causal_relation_id, cause_event, effect_event,
            cause_occurred_at, effect_occurred_at, description, source)
         values
           ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'Cause', 'Effect',
            '2026-02-01', '2026-02-02', 'Explanation', 'Public source')`,
      ),
      '23503',
    );

    await pool!.query(
      `insert into concrete_causal_cases
         (causal_relation_id, cause_event, effect_event,
          cause_occurred_at, effect_occurred_at, description, source)
       values
         ($1, 'Policy rate rose', 'Liquidity tightened',
          '2026-02-01', '2026-02-02', 'Observed sequence', 'Public source')`,
      [relationId],
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

  it('creates indexes for every foreign key and directional query', async () => {
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
        'causal_relations_cause_event_id_idx',
        'causal_relations_effect_event_id_idx',
        'concrete_cases_relation_effect_time_idx',
      ]),
    );
  });
});
