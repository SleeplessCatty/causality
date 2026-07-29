import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresAiImportHistoryRepository } from '../src/features/ai-capture/aiImportHistoryRepository.js';
import { startPostgresTestContext } from './support/postgresTestContext.js';

describe.sequential('AI import successful history PostgreSQL queries', () => {
  const causeEventId = '30000000-0000-4000-8000-000000000001';
  const effectEventId = '30000000-0000-4000-8000-000000000002';
  const concreteCaseId = '40000000-0000-4000-8000-000000000001';
  const relationId = '50000000-0000-4000-8000-000000000001';
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
           relation_case_created, relation_case_reused, confidence_changed
         )
         values (
           $1, $2, $3, 1, 'history-test',
           '2026-07-28T00:00:00Z'::timestamptz + ($4 * interval '1 minute'),
           $4, 0, 0, 0, 0, 0, 0, 0,
           case when $4 = 51 then 1 else 0 end,
           0
         )`,
        [batchId, planId, `历史主题 ${index}`, index],
      );
      if (index === 51) newestBatchId = batchId;
    }

    await pool.query(
      `insert into abstract_events (id, name)
       values ($1, '能源价格上升'), ($2, '生产成本上升')`,
      [causeEventId, effectEventId],
    );
    await pool.query(`insert into concrete_cases (id, content) values ($1, $2)`, [
      concreteCaseId,
      '2026年某地区能源现货价格持续上涨。',
    ]);
    await pool.query(
      `insert into causal_relations (
         id, cause_event_id, effect_event_id, confidence,
         baseline_confidence, baseline_case_count, description
       )
       values ($1, $2, $3, 19, 10, 0, '能源成本传导至生产成本')`,
      [relationId, causeEventId, effectEventId],
    );

    const records = [
      [1, 'event', 'created', causeEventId, null, { ref: 'event-1' }],
      [2, 'case', 'reused', concreteCaseId, null, { ref: 'case-1' }],
      [
        3,
        'relation',
        'reused',
        relationId,
        null,
        { ref: 'relation-1', causeEventId, effectEventId },
      ],
      [
        4,
        'relation_case',
        'created',
        relationId,
        concreteCaseId,
        { relationRef: 'relation-1', caseRef: 'case-1' },
      ],
      [
        5,
        'confidence',
        'changed',
        relationId,
        null,
        {
          relationRef: 'relation-1',
          oldConfidence: 10,
          newConfidence: 19,
          oldCaseCount: 0,
          newCaseCount: 1,
        },
      ],
    ] as const;
    for (const [index, recordType, action, primaryRecordId, relatedRecordId, detail] of records) {
      await pool.query(
        `insert into ai_import_records (
           batch_id, sequence, record_type, action,
           primary_record_id, related_record_id, detail
         )
         values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [
          newestBatchId,
          index,
          recordType,
          action,
          primaryRecordId,
          relatedRecordId,
          JSON.stringify(detail),
        ],
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
      counts: { eventCreated: 51, relationCaseCreated: 0, relationCaseReused: 1 },
    });
    const records = await Promise.all(
      (['event', 'case', 'relation', 'relation_case', 'confidence'] as const).map((type) =>
        repository.listRecords(newestBatchId, type, 1),
      ),
    );
    for (const response of records) {
      expect(response).toMatchObject({
        page: 1,
        pageSize: 50,
        totalItems: 1,
        totalPages: 1,
      });
    }
    expect(records[0]!.items[0]!.detail).toMatchObject({ name: '能源价格上升' });
    expect(records[1]!.items[0]!.detail).toMatchObject({
      content: '2026年某地区能源现货价格持续上涨。',
    });
    for (const response of records.slice(2)) {
      expect(response.items[0]!.detail).toMatchObject({
        causeEventName: '能源价格上升',
        effectEventName: '生产成本上升',
        relationDescription: '能源成本传导至生产成本',
      });
    }
    expect(records[3]!.items[0]!.detail).toMatchObject({
      caseContent: '2026年某地区能源现货价格持续上涨。',
    });
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
