import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresAiImportHistoryRepository } from '../src/features/ai-capture/aiImportHistoryRepository.js';
import { startPostgresTestContext } from './support/postgresTestContext.js';

describe.sequential('AI import successful history PostgreSQL queries', () => {
  let context: Awaited<ReturnType<typeof startPostgresTestContext>>;
  let pool: Pool;
  let repository: PostgresAiImportHistoryRepository;
  let newestBatchId: string;

  beforeAll(async () => {
    context = await startPostgresTestContext('causality_ai_import_history_test');
    ({ pool } = context);
    repository = new PostgresAiImportHistoryRepository(pool);

    for (let index = 1; index <= 51; index += 1) {
      const planId = `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
      const batchId = `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
      await pool.query(
        `insert into ai_import_plans (
           id, version, status, topic, client_name,
           candidate_payload, plan_payload, result_payload,
           created_at, expires_at, committed_at
         )
         values (
           $1, 1, 'committed', $2, 'history-test',
           '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
           $3::timestamptz - interval '1 minute',
           $3::timestamptz + interval '29 minutes',
           $3::timestamptz
         )`,
        [planId, `历史主题 ${index}`, `2026-07-28T${String(index % 24).padStart(2, '0')}:00:00Z`],
      );
      await pool.query(
        `insert into ai_import_batches (
           id, plan_id, topic, plan_version, client_name, completed_at,
           event_created, event_reused, event_updated,
           case_created, case_reused,
           relation_created, relation_reused,
           relation_case_created, confidence_changed
         )
         values (
           $1, $2, $3, 1, 'history-test',
           '2026-07-28T00:00:00Z'::timestamptz + ($4 * interval '1 minute'),
           $4, 0, 0, 0, 0, 0, 0, 0, 0
         )`,
        [batchId, planId, `历史主题 ${index}`, index],
      );
      if (index === 51) newestBatchId = batchId;
    }

    const longContent = '很长的历史详情'.repeat(200);
    for (const [index, recordType, action] of [
      [1, 'event', 'created'],
      [2, 'case', 'reused'],
      [3, 'relation', 'created'],
      [4, 'relation_case', 'created'],
      [5, 'confidence', 'changed'],
    ] as const) {
      await pool.query(
        `insert into ai_import_records (
           batch_id, sequence, record_type, action,
           primary_record_id, related_record_id, detail
         )
         values (
           $1, $2, $3, $4,
           (lpad($5::text, 8, '0') || '-0000-4000-8000-000000000000')::uuid,
           null, jsonb_build_object('content', $6::text)
         )`,
        [newestBatchId, index, recordType, action, index, longContent],
      );
    }
  }, 120_000);

  afterAll(async () => {
    await context.close();
  });

  it('lists only successful batches newest first with a fixed page size of 50', async () => {
    const first = await repository.list(1);
    const second = await repository.list(2);

    expect(first).toMatchObject({
      page: 1,
      pageSize: 50,
      totalItems: 51,
      totalPages: 2,
    });
    expect(first.items).toHaveLength(50);
    expect(first.items[0]?.id).toBe(newestBatchId);
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.topic).toBe('历史主题 1');
  });

  it('returns batch detail and independently paginates every history category', async () => {
    const detail = await repository.findById(newestBatchId);

    expect(detail).toMatchObject({
      id: newestBatchId,
      topic: '历史主题 51',
      counts: { eventCreated: 51 },
    });
    for (const type of ['event', 'case', 'relation', 'relation_case', 'confidence'] as const) {
      const records = await repository.listRecords(newestBatchId, type, 1);
      expect(records).toMatchObject({
        page: 1,
        pageSize: 50,
        totalItems: 1,
        totalPages: 1,
      });
      expect(records.items[0]?.recordType).toBe(type);
      expect(String(records.items[0]?.detail.content).length).toBeGreaterThan(1_000);
    }
  });

  it('returns null for a missing batch and an empty first page for a missing category', async () => {
    const missingId = '90000000-0000-4000-8000-000000000001';

    await expect(repository.findById(missingId)).resolves.toBeNull();
    await expect(repository.listRecords(missingId, 'event', 1)).resolves.toEqual({
      items: [],
      page: 1,
      pageSize: 50,
      totalItems: 0,
      totalPages: 1,
    });
  });
});
