import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runFixedSeed } from '../src/database/test-data/fixedSeed.js';
import { runSimulation } from '../src/database/test-data/simulate.js';
import { verifyDatabase } from '../src/database/verify.js';
import { startPostgresTestContext } from './support/postgresTestContext.js';

const firstFixedEventId = '00000000-0000-4000-8000-000000000001';

describe.sequential('database data tools', () => {
  let context: Awaited<ReturnType<typeof startPostgresTestContext>> | undefined;
  let pool: Pool | undefined;

  beforeAll(async () => {
    context = await startPostgresTestContext('causality_database_tools_test');
    ({ pool } = context);
  }, 120_000);

  afterAll(async () => {
    await context?.close();
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
      keywords: string;
      relations: string;
    }>(
      `select
         (select count(*) from abstract_events) as events,
         (select count(*) from event_aliases) as aliases,
         (select count(*) from event_keywords) as keywords,
         (select count(*) from causal_relations) as relations,
         (select count(*) from concrete_cases) as cases,
         (select count(*) from causal_relation_cases) as "caseLinks"`,
    );
    expect(counts.rows[0]).toEqual({
      events: '200',
      aliases: '200',
      keywords: '400',
      relations: '180',
      cases: '220',
      caseLinks: '220',
    });

    const event = await pool!.query<{ description: string }>(
      'select description from abstract_events where id = $1',
      [firstFixedEventId],
    );
    expect(event.rows[0]?.description).toBe('User edited description');

    const keywords = await pool!.query<{ keyword: string; position: number }>(
      `select keyword, position
       from event_keywords
       where event_id = $1
       order by position`,
      [firstFixedEventId],
    );
    expect(keywords.rows).toEqual([
      { keyword: '经济与经营', position: 1 },
      { keyword: '融资与投资', position: 2 },
    ]);
  });

  it('reports migration state, counts, and zero integrity violations', async () => {
    const report = await verifyDatabase(pool!);

    expect(report.migrationApplied).toBe(true);
    expect(report.counts).toEqual({
      abstractEvents: 200,
      eventAliases: 200,
      causalRelations: 180,
      concreteCases: 220,
      causalRelationCaseLinks: 220,
    });
    expect(report.integrity).toEqual({
      selfLoops: 0,
      invalidConfidence: 0,
      duplicateCaseLinks: 0,
      invalidForeignKeys: 0,
      orphanedKeywords: 0,
      duplicateNormalizedKeywords: 0,
      invalidKeywordLengths: 0,
    });
    expect(report.semantic).toEqual({
      extensionInstalled: true,
      requiredTablesPresent: true,
      invalidModelCodes: 0,
      invalidVectorDimensions: 0,
      inactiveModelVectors: 0,
    });
    expect(report.valid).toBe(true);
  });

  it('reports missing semantic storage instead of throwing a generic verification failure', async () => {
    const client = await pool!.connect();
    try {
      await client.query('begin');
      await client.query('drop table semantic_embeddings');

      const report = await verifyDatabase(client);

      expect(report.semantic.requiredTablesPresent).toBe(false);
      expect(report.valid).toBe(false);
    } finally {
      await client.query('rollback');
      client.release();
    }
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
      abstractEvents: 220,
      eventAliases: 220,
      causalRelations: 230,
      concreteCases: 300,
      causalRelationCaseLinks: 295,
    });
    expect(report.valid).toBe(true);

    const keywordCount = await pool!.query<{ count: string }>(
      'select count(*) from event_keywords',
    );
    expect(keywordCount.rows[0]?.count).toBe('440');
  });
});
