import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PostgresImportHistoryRepository } from '../src/features/data-transfer/importHistoryRepository.js';
import {
  startPostgresTestContext,
  type StartedPostgresTestContext,
} from './support/postgresTestContext.js';

const liveEventId = '41000000-0000-4000-8000-000000000001';

async function resetDatabase(pool: Pool): Promise<void> {
  await pool.query(`
    delete from import_batches;
    delete from causal_relation_cases;
    delete from causal_relations;
    delete from event_aliases;
    delete from event_keywords;
    delete from abstract_events;
    delete from concrete_cases;
  `);
}

async function seedHistory(pool: Pool): Promise<void> {
  await pool.query(
    `insert into import_batches (
       filename,
       completed_at,
       record_types,
       event_created,
       event_reused,
       case_created,
       case_reused,
       relation_created,
       relation_reused,
       relation_case_created,
       relation_case_reused
     )
     select
       '批次-' || sequence || '.csv',
       timestamptz '2026-07-27 00:00:00+00' + sequence * interval '1 second',
       array['event']::varchar[],
       sequence,
       0,
       0,
       0,
       0,
       0,
       0,
       0
     from generate_series(1, 52) as input(sequence)`,
  );
}

async function seedDetailBatch(pool: Pool): Promise<string> {
  await pool.query(`insert into abstract_events (id, name) values ($1, '随后删除的业务事件')`, [
    liveEventId,
  ]);
  const batch = await pool.query<{ id: string }>(
    `insert into import_batches (
       filename,
       completed_at,
       record_types,
       event_created,
       event_reused,
       case_created,
       case_reused,
       relation_created,
       relation_reused,
       relation_case_created,
       relation_case_reused
     )
     values (
       '详情数据.csv',
       '2026-07-27T10:00:00.000Z',
       array['event', 'case', 'relation', 'relation_case']::varchar[],
       52,
       0,
       1,
       0,
       0,
       1,
       1,
       0
     )
     returning id`,
  );
  const batchId = batch.rows[0]!.id;

  await pool.query(
    `insert into import_records (
       batch_id,
       source_sequence,
       item_sequence,
       record_type,
       outcome,
       primary_record_id,
       related_record_id,
       text_snapshot
     )
     select
       $1,
       sequence,
       1,
       'event',
       'created',
       case when sequence = 1 then $2::uuid else gen_random_uuid() end,
       null,
       jsonb_build_object('type', 'event', 'eventName', '导入事件 ' || sequence)
     from generate_series(1, 52) as input(sequence)`,
    [batchId, liveEventId],
  );
  await pool.query(
    `insert into import_records (
       batch_id,
       source_sequence,
       item_sequence,
       record_type,
       outcome,
       primary_record_id,
       related_record_id,
       text_snapshot
     )
     values
       ($1, 100, 1, 'case', 'created', gen_random_uuid(), null,
        '{"type":"case","caseContent":"导入时保存的案例内容"}'),
       ($1, 101, 1, 'relation', 'reused', gen_random_uuid(), null,
        '{"type":"relation","causeEventName":"原因事件","effectEventName":"结果事件"}'),
       ($1, 101, 3, 'relation_case', 'created', gen_random_uuid(), gen_random_uuid(),
        '{"type":"relation_case","causeEventName":"原因事件","effectEventName":"结果事件","caseContent":"关联案例"}')`,
    [batchId],
  );
  await pool.query(`delete from abstract_events where id = $1`, [liveEventId]);
  return batchId;
}

describe.sequential('PostgresImportHistoryRepository', () => {
  let context: StartedPostgresTestContext | undefined;
  let pool: Pool | undefined;
  let repository: PostgresImportHistoryRepository | undefined;

  beforeAll(async () => {
    context = await startPostgresTestContext('causality_data_transfer_history_test');
    pool = context.pool;
    repository = new PostgresImportHistoryRepository(pool);
  }, 120_000);

  beforeEach(async () => {
    await resetDatabase(pool!);
  });

  afterAll(async () => {
    await context?.close();
  });

  it('returns stable reverse history pages and corrects a page beyond the end', async () => {
    await seedHistory(pool!);

    const firstPage = await repository!.listBatches({ page: 1 });
    const secondPage = await repository!.listBatches({ page: 2 });
    const correctedPage = await repository!.listBatches({ page: 999 });

    expect(firstPage).toMatchObject({
      page: 1,
      pageSize: 50,
      totalItems: 52,
      totalPages: 2,
    });
    expect(firstPage.items[0]).toMatchObject({
      filename: '批次-52.csv',
      counts: { event: { created: 52, reused: 0 } },
    });
    expect(firstPage.items[49]?.filename).toBe('批次-3.csv');
    expect(secondPage.items.map((item) => item.filename)).toEqual(['批次-2.csv', '批次-1.csv']);
    expect(correctedPage).toEqual(secondPage);
  });

  it('reads persisted summary counts without consulting live business tables', async () => {
    await seedHistory(pool!);
    const page = await repository!.listBatches({ page: 1 });
    const batch = await repository!.findBatch(page.items[0]!.id);

    expect(batch).toEqual(page.items[0]);
    expect(batch?.counts.event.created).toBe(52);
    const businessCount = await pool!.query<{ count: number }>(
      `select count(*)::int as count from abstract_events`,
    );
    expect(businessCount.rows[0]?.count).toBe(0);
  });

  it('filters all four detail types, hides internal IDs, and preserves snapshots after deletion', async () => {
    const batchId = await seedDetailBatch(pool!);

    const events = await repository!.listRecords(batchId, { type: 'event', page: 1 });
    const cases = await repository!.listRecords(batchId, { type: 'case', page: 1 });
    const relations = await repository!.listRecords(batchId, { type: 'relation', page: 1 });
    const links = await repository!.listRecords(batchId, {
      type: 'relation_case',
      page: 1,
    });

    expect(events).toMatchObject({
      page: 1,
      pageSize: 50,
      totalItems: 52,
      totalPages: 2,
    });
    expect(events?.items[0]).toMatchObject({
      sequence: 1,
      outcome: 'created',
      text: { type: 'event', eventName: '导入事件 1' },
    });
    expect(Object.keys(events!.items[0]!).sort()).toEqual(['id', 'outcome', 'sequence', 'text']);
    expect(cases?.items).toMatchObject([
      {
        sequence: 100,
        outcome: 'created',
        text: { type: 'case', caseContent: '导入时保存的案例内容' },
      },
    ]);
    expect(relations?.items[0]?.text).toEqual({
      type: 'relation',
      causeEventName: '原因事件',
      effectEventName: '结果事件',
    });
    expect(links?.items[0]?.text).toEqual({
      type: 'relation_case',
      causeEventName: '原因事件',
      effectEventName: '结果事件',
      caseContent: '关联案例',
    });
  });

  it('keeps independent detail pagination and corrects out-of-range pages', async () => {
    const batchId = await seedDetailBatch(pool!);

    const eventPageTwo = await repository!.listRecords(batchId, { type: 'event', page: 2 });
    const corrected = await repository!.listRecords(batchId, { type: 'event', page: 999 });
    const casePage = await repository!.listRecords(batchId, { type: 'case', page: 999 });

    expect(eventPageTwo).toMatchObject({
      page: 2,
      totalItems: 52,
      totalPages: 2,
    });
    expect(eventPageTwo?.items.map((item) => item.sequence)).toEqual([51, 52]);
    expect(corrected).toEqual(eventPageTwo);
    expect(casePage).toMatchObject({
      page: 1,
      totalItems: 1,
      totalPages: 1,
    });
  });

  it('returns null for a missing batch and never returns unrelated details', async () => {
    const missingId = 'f1000000-0000-4000-8000-000000000099';

    await expect(repository!.findBatch(missingId)).resolves.toBeNull();
    await expect(
      repository!.listRecords(missingId, { type: 'event', page: 1 }),
    ).resolves.toBeNull();
  });
});
