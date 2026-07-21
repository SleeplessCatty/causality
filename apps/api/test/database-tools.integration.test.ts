import { Pool } from 'pg';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runMigrations } from '../src/database/migrate.js';
import { runFixedSeed } from '../src/database/test-data/fixedSeed.js';
import { runSimulation } from '../src/database/test-data/simulate.js';
import { verifyDatabase } from '../src/database/verify.js';

const firstFixedEventId = '00000000-0000-4000-8000-000000000001';

describe.sequential('database data tools', () => {
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
    await runMigrations(pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it('loads fixed data idempotently without overwriting user edits', async () => {
    await runFixedSeed(pool!);
    await pool!.query(
      `update abstract_events
       set description = 'User edited description'
       where id = $1`,
      [firstFixedEventId],
    );

    await runFixedSeed(pool!);

    const counts = await pool!.query<{
      aliases: string;
      cases: string;
      caseLinks: string;
      events: string;
      relations: string;
    }>(
      `select
         (select count(*) from abstract_events) as events,
         (select count(*) from event_aliases) as aliases,
         (select count(*) from causal_relations) as relations,
         (select count(*) from concrete_cases) as cases,
         (select count(*) from causal_relation_cases) as "caseLinks"`,
    );
    expect(counts.rows[0]).toEqual({
      events: '12',
      aliases: '12',
      relations: '15',
      cases: '18',
      caseLinks: '18',
    });

    const event = await pool!.query<{ description: string }>(
      'select description from abstract_events where id = $1',
      [firstFixedEventId],
    );
    expect(event.rows[0]?.description).toBe('User edited description');
  });

  it('reports migration state, counts, and zero integrity violations', async () => {
    const report = await verifyDatabase(pool!);

    expect(report.migrationApplied).toBe(true);
    expect(report.counts).toEqual({
      abstractEvents: 12,
      eventAliases: 12,
      causalRelations: 15,
      concreteCases: 18,
      causalRelationCaseLinks: 18,
    });
    expect(report.integrity).toEqual({
      selfLoops: 0,
      invalidConfidence: 0,
      duplicateCaseLinks: 0,
      invalidForeignKeys: 0,
    });
    expect(report.valid).toBe(true);
  });

  it('inserts a configured simulation batch without breaking integrity', async () => {
    const result = await runSimulation(
      pool!,
      { events: 20, relations: 50, cases: 80, seed: 42 },
      'integration-batch',
    );

    expect(result).toMatchObject({
      batchId: 'integration-batch',
      inserted: { events: 20, aliases: 20, relations: 50, cases: 80, caseLinks: 75 },
    });
    expect(result.elapsedMilliseconds).toBeGreaterThanOrEqual(0);

    const report = await verifyDatabase(pool!);
    expect(report.counts).toEqual({
      abstractEvents: 32,
      eventAliases: 32,
      causalRelations: 65,
      concreteCases: 98,
      causalRelationCaseLinks: 93,
    });
    expect(report.valid).toBe(true);
  });
});
