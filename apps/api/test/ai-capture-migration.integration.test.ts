import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type StartedPostgresTestContext,
  startPostgresTestContext,
} from './support/postgresTestContext.js';

const pendingPlanId = '10000000-0000-4000-8000-000000000001';
const committedPlanId = '10000000-0000-4000-8000-000000000002';
const batchId = '20000000-0000-4000-8000-000000000001';
const eventId = '30000000-0000-4000-8000-000000000001';
const recordId = '40000000-0000-4000-8000-000000000001';

async function insertPlan(
  pool: Pool,
  input: {
    id: string;
    status: string;
    createdAt?: string;
    expiresAt?: string;
    committedAt?: string | null;
  },
): Promise<void> {
  await pool.query(
    `insert into ai_import_plans (
       id, version, status, topic, client_name,
       candidate_payload, plan_payload, result_payload,
       created_at, expires_at, committed_at
     )
     values (
       $1, 1, $2, '供应链中断的影响', 'integration-test',
       '{}'::jsonb, '{}'::jsonb, $3::jsonb,
       $4::timestamptz, $5::timestamptz, $6::timestamptz
     )`,
    [
      input.id,
      input.status,
      input.status === 'committed' ? '{}' : null,
      input.createdAt ?? '2026-07-28T10:00:00.000Z',
      input.expiresAt ?? '2026-07-28T10:30:00.000Z',
      input.committedAt ?? (input.status === 'committed' ? '2026-07-28T10:10:00.000Z' : null),
    ],
  );
}

async function insertBatch(database: Pool | PoolClient, id: string, planId: string): Promise<void> {
  await database.query(
    `insert into ai_import_batches (
       id, plan_id, topic, plan_version, client_name,
       event_created, event_reused, event_updated,
       case_created, case_reused,
       relation_created, relation_reused,
       relation_case_created, relation_case_reused, confidence_changed
     )
     values (
       $1, $2, '供应链中断的影响', 1, 'integration-test',
       1, 0, 0, 0, 0, 0, 0, 0, 0, 0
     )`,
    [id, planId],
  );
}

describe.sequential('AI capture foundation migration', () => {
  let context: StartedPostgresTestContext;

  beforeAll(async () => {
    context = await startPostgresTestContext('causality_ai_capture_foundation_test');
  });

  afterAll(async () => {
    await context.close();
  });

  it('allows only the approved plan states and a positive lifetime', async () => {
    const statuses = [
      'pending',
      'replaced',
      'invalidated',
      'expired',
      'submitting',
      'committed',
      'data_failed',
      'system_failed',
    ];
    for (const [index, status] of statuses.entries()) {
      await insertPlan(context.pool, {
        id: `11000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        status,
      });
    }

    await expect(
      insertPlan(context.pool, {
        id: '11000000-0000-4000-8000-000000000099',
        status: 'cancelled',
      }),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      insertPlan(context.pool, {
        id: '11000000-0000-4000-8000-000000000100',
        status: 'pending',
        expiresAt: '2026-07-28T10:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('requires each successful batch to reference one committed plan exactly once', async () => {
    await insertPlan(context.pool, { id: pendingPlanId, status: 'pending' });

    const client = await context.pool.connect();
    try {
      await client.query('begin');
      await insertBatch(client, '20000000-0000-4000-8000-000000000099', pendingPlanId);
      await expect(client.query('commit')).rejects.toMatchObject({ code: '23514' });
      await client.query('rollback');
    } finally {
      client.release();
    }

    await insertPlan(context.pool, { id: committedPlanId, status: 'committed' });
    await insertBatch(context.pool, batchId, committedPlanId);

    const committedPlanClient = await context.pool.connect();
    try {
      await committedPlanClient.query('begin');
      await committedPlanClient.query(
        `update ai_import_plans set status = 'pending' where id = $1`,
        [committedPlanId],
      );
      await expect(committedPlanClient.query('commit')).rejects.toMatchObject({ code: '23514' });
      await committedPlanClient.query('rollback');
    } finally {
      committedPlanClient.release();
    }

    await expect(
      insertBatch(context.pool, '20000000-0000-4000-8000-000000000002', committedPlanId),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('cascades history records with a batch without deleting referenced business rows', async () => {
    await context.pool.query(`insert into abstract_events (id, name) values ($1, '港口停止作业')`, [
      eventId,
    ]);
    await context.pool.query(
      `insert into ai_import_records (
         id, batch_id, sequence, record_type, action,
         primary_record_id, related_record_id, detail
       )
       values ($1, $2, 1, 'event', 'created', $3, null, '{"name":"港口停止作业"}'::jsonb)`,
      [recordId, batchId, eventId],
    );

    await context.pool.query(`delete from ai_import_batches where id = $1`, [batchId]);

    const result = await context.pool.query<{
      business_count: number;
      history_count: number;
    }>(
      `select
         (select count(*)::int from abstract_events where id = $1) as business_count,
         (select count(*)::int from ai_import_records where id = $2) as history_count`,
      [eventId, recordId],
    );
    expect(result.rows[0]).toEqual({ business_count: 1, history_count: 0 });
  });

  it('creates exactly one MCP singleton with a versioned 64-hex token', async () => {
    const result = await context.pool.query<{
      count: number;
      token_valid: boolean;
      token_version: number;
    }>(
      `select count(*)::int as count,
              bool_and(access_token ~ '^[0-9a-f]{64}$') as token_valid,
              min(token_version)::int as token_version
       from mcp_settings`,
    );

    expect(result.rows).toEqual([{ count: 1, token_valid: true, token_version: 1 }]);
    await expect(
      context.pool.query(
        `insert into mcp_settings (singleton_key, access_token, token_version)
         values (false, repeat('a', 64), 1)`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
