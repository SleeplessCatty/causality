import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runFixedSeed } from '../src/database/test-data/fixedSeed.js';
import { runSimulation } from '../src/database/test-data/simulate.js';
import { verifyDatabase } from '../src/database/verify.js';
import { PostgresExportRequestRepository } from '../src/features/data-transfer/exportRequestRepository.js';
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
      events: '600',
      aliases: '600',
      keywords: '1200',
      relations: '500',
      cases: '620',
      caseLinks: '620',
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

  it('adds the expanded seed to an existing 200-event seed without replacing prior records', async () => {
    await pool!.query(
      `delete from causal_relation_cases
       where split_part(concrete_case_id::text, '-', 5)::bigint > 220;
       delete from concrete_cases
       where id::text like '00000000-0000-4000-8200-%'
         and split_part(id::text, '-', 5)::bigint > 220;
       delete from causal_relations
       where id::text like '00000000-0000-4000-8100-%'
         and split_part(id::text, '-', 5)::bigint > 180;
       delete from event_keywords
       where event_id::text like '00000000-0000-4000-8000-%'
         and split_part(event_id::text, '-', 5)::bigint > 200;
       delete from event_aliases
       where event_id::text like '00000000-0000-4000-8000-%'
         and split_part(event_id::text, '-', 5)::bigint > 200;
       delete from abstract_events
       where id::text like '00000000-0000-4000-8000-%'
         and split_part(id::text, '-', 5)::bigint > 200`,
    );

    await runFixedSeed(pool!);

    const counts = await pool!.query<{
      cases: number;
      events: number;
      relations: number;
    }>(
      `select
         (select count(*)::int from abstract_events) as events,
         (select count(*)::int from causal_relations) as relations,
         (select count(*)::int from concrete_cases) as cases`,
    );
    expect(counts.rows[0]).toEqual({ events: 600, relations: 500, cases: 620 });
    const priorBridge = await pool!.query<{ description: string | null }>(
      `select description
       from causal_relations
       where id = '00000000-0000-4000-8100-000000000161'`,
    );
    expect(priorBridge.rows[0]?.description).toBe('融资支出增加会削弱企业的盈利预期');
  });

  it('reports migration state, counts, and zero integrity violations', async () => {
    const report = await verifyDatabase(pool!);

    expect(report.migrationApplied).toBe(true);
    expect(report.counts).toEqual({
      abstractEvents: 600,
      eventAliases: 600,
      causalRelations: 500,
      concreteCases: 620,
      causalRelationCaseLinks: 620,
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
      invalidThresholds: 0,
      invalidLifecycleStates: 0,
      invalidDataCheckSemanticStates: 0,
    });
    expect(report.dataTransfer).toEqual({
      requiredTablesPresent: true,
      requiredIndexesPresent: true,
      invalidImportCounts: 0,
      invalidImportRecordSnapshots: 0,
      expiredExportRequests: 0,
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

  it('deletes only expired export requests without changing business records', async () => {
    const before = await verifyDatabase(pool!);
    const repository = new PostgresExportRequestRepository({
      createToken: () => 'a'.repeat(43),
    });
    const client = await pool!.connect();
    try {
      await client.query('begin');
      await repository.create(
        client,
        { type: 'full' },
        new Date('2026-01-01T00:00:00.000Z'),
        new Date('2026-01-01T00:10:00.000Z'),
      );
      await client.query('commit');
    } finally {
      client.release();
    }

    const withExpired = await verifyDatabase(pool!);
    expect(withExpired.dataTransfer.expiredExportRequests).toBe(1);
    expect(withExpired.valid).toBe(true);

    const cleanupClient = await pool!.connect();
    try {
      await cleanupClient.query('begin');
      expect(
        await repository.deleteExpired(cleanupClient, new Date('2026-01-01T00:10:00.000Z')),
      ).toBe(1);
      await cleanupClient.query('commit');
    } finally {
      cleanupClient.release();
    }

    const after = await verifyDatabase(pool!);
    expect(after.dataTransfer.expiredExportRequests).toBe(0);
    expect(after.counts).toEqual(before.counts);
    expect(after.valid).toBe(true);
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
      abstractEvents: 620,
      eventAliases: 620,
      causalRelations: 550,
      concreteCases: 700,
      causalRelationCaseLinks: 695,
    });
    expect(report.valid).toBe(true);

    const keywordCount = await pool!.query<{ count: string }>(
      'select count(*) from event_keywords',
    );
    expect(keywordCount.rows[0]?.count).toBe('1240');
  });
});
