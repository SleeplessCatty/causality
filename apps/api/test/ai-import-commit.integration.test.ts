import type { AiImportChangeCounts, AiWorkflowError } from '@causality/contracts';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PostgresAiImportCommitRepository } from '../src/features/ai-capture/aiImportCommitRepository.js';
import { AiImportCommitService } from '../src/features/ai-capture/aiImportCommitService.js';
import { AiImportCommitError } from '../src/features/ai-capture/aiWorkflowErrorClassifier.js';
import {
  fingerprintDependency,
  type PreparedMutationSet,
} from '../src/features/ai-capture/aiImportPlanValidator.js';
import { startPostgresTestContext } from './support/postgresTestContext.js';

const existingCauseId = '10000000-0000-4000-8000-000000000001';
const existingEffectId = '10000000-0000-4000-8000-000000000002';
const existingCaseId = '20000000-0000-4000-8000-000000000001';
const existingRelationId = '30000000-0000-4000-8000-000000000001';

const emptyCounts: AiImportChangeCounts = {
  eventCreated: 0,
  eventReused: 0,
  eventUpdated: 0,
  caseCreated: 0,
  caseReused: 0,
  relationCreated: 0,
  relationReused: 0,
  relationCaseCreated: 0,
  relationCaseReused: 0,
  confidenceChanged: 0,
};

function emptyMutations(): PreparedMutationSet {
  return {
    createEvents: [],
    updateEvents: [],
    reuseEvents: [],
    createCases: [],
    reuseCases: [],
    createRelations: [],
    reuseRelations: [],
    createLinks: [],
    confidenceChanges: [],
    skipped: [],
    dependencies: [],
    summary: { ...emptyCounts },
  };
}

async function insertPlan(
  pool: Pool,
  mutations: PreparedMutationSet,
  options: {
    id?: string;
    status?: string;
    version?: number;
    replacesPlanId?: string | null;
    expiresAt?: string;
  } = {},
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into ai_import_plans (
       id, version, replaces_plan_id, status, topic, client_name,
       candidate_payload, plan_payload, created_at, expires_at
     )
     values (
       coalesce($1::uuid, gen_random_uuid()), $2, $3, $4,
       '供应链变化', 'integration-test',
       '{"topic":"供应链变化"}'::jsonb,
       jsonb_build_object(
         'comparison', '{}'::jsonb,
         'decisions', '{}'::jsonb,
         'mutations', $5::jsonb,
         'payloadHash', repeat('a', 64)
       ),
       clock_timestamp(), $6::timestamptz
     )
     returning id`,
    [
      options.id ?? null,
      options.version ?? 1,
      options.replacesPlanId ?? null,
      options.status ?? 'pending',
      JSON.stringify(mutations),
      options.expiresAt ?? '2099-07-28T12:30:00.000Z',
    ],
  );
  return result.rows[0]!.id;
}

describe.sequential('AI import commit PostgreSQL transaction', () => {
  let context: Awaited<ReturnType<typeof startPostgresTestContext>>;
  let pool: Pool;
  let service: AiImportCommitService;

  beforeAll(async () => {
    context = await startPostgresTestContext('causality_ai_import_commit_test');
    ({ pool } = context);
    service = new AiImportCommitService(new PostgresAiImportCommitRepository(pool));
  }, 120_000);

  beforeEach(async () => {
    await pool.query(`delete from ai_import_batches`);
    await pool.query(`delete from ai_import_plans`);
    await pool.query(`delete from causal_relation_cases`);
    await pool.query(`delete from causal_relations`);
    await pool.query(`delete from event_aliases`);
    await pool.query(`delete from event_keywords`);
    await pool.query(`delete from concrete_cases`);
    await pool.query(`delete from abstract_events`);
    await pool.query(
      `insert into abstract_events (id, name, description)
       values
         ($1, '港口停止作业', '原说明'),
         ($2, '零部件到货延迟', null)`,
      [existingCauseId, existingEffectId],
    );
    await pool.query(
      `insert into concrete_cases (id, content)
       values ($1, '既有港口停工案例')`,
      [existingCaseId],
    );
    await pool.query(
      `insert into causal_relations (
         id, cause_event_id, effect_event_id, confidence,
         baseline_confidence, baseline_case_count, description
       )
       values ($1, $2, $3, 10, 10, 0, '既有关系')`,
      [existingRelationId, existingCauseId, existingEffectId],
    );
  });

  afterAll(async () => {
    await context.close();
  });

  it('applies only approved mutations, records all history categories, and returns the stored result on retry', async () => {
    const mutations = emptyMutations();
    mutations.createEvents = [
      {
        ref: 'event-created',
        name: '替代运输启用',
        description: '启用铁路替代运输',
        aliases: ['铁路替代'],
        keywords: ['运输'],
      },
    ];
    mutations.reuseEvents = [
      { ref: 'event-cause', id: existingCauseId },
      { ref: 'event-effect', id: existingEffectId },
    ];
    mutations.updateEvents = [
      {
        ref: 'event-cause',
        id: existingCauseId,
        appendAliases: ['码头停工'],
        appendKeywords: ['港口'],
        oldDescription: '原说明',
        newDescription: '更新后的港口作业说明',
      },
    ];
    mutations.createCases = [{ ref: 'case-created', content: '新增替代运输案例' }];
    mutations.reuseCases = [{ ref: 'case-existing', id: existingCaseId }];
    mutations.createRelations = [
      {
        ref: 'relation-created',
        causeEvent: { kind: 'existing', id: existingCauseId },
        effectEvent: { kind: 'create', ref: 'event-created' },
        description: '港口停工促使替代运输启用',
      },
    ];
    mutations.reuseRelations = [{ ref: 'relation-existing', id: existingRelationId }];
    mutations.createLinks = [
      { relationRef: 'relation-existing', caseRef: 'case-existing' },
      { relationRef: 'relation-created', caseRef: 'case-created' },
    ];
    mutations.confidenceChanges = [
      {
        relationRef: 'relation-existing',
        relationId: existingRelationId,
        oldConfidence: 10,
        newConfidence: 19,
        oldCaseCount: 0,
        newCaseCount: 1,
      },
      {
        relationRef: 'relation-created',
        relationId: null,
        oldConfidence: 10,
        newConfidence: 19,
        oldCaseCount: 0,
        newCaseCount: 1,
      },
    ];
    mutations.summary = {
      eventCreated: 1,
      eventReused: 2,
      eventUpdated: 1,
      caseCreated: 1,
      caseReused: 1,
      relationCreated: 1,
      relationReused: 1,
      relationCaseCreated: 2,
      relationCaseReused: 0,
      confidenceChanged: 2,
    };
    const planId = await insertPlan(pool, mutations);

    const first = await service.commit(planId);
    const second = await service.commit(planId);

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      planId,
      marker: `[Causality-Capture: ${first.historyId}]`,
      noChanges: false,
      counts: mutations.summary,
    });
    const state = await pool.query<{
      events: number;
      cases: number;
      relations: number;
      links: number;
      batches: number;
      description: string;
      confidence: string;
    }>(
      `select
         (select count(*)::int from abstract_events) as events,
         (select count(*)::int from concrete_cases) as cases,
         (select count(*)::int from causal_relations) as relations,
         (select count(*)::int from causal_relation_cases) as links,
         (select count(*)::int from ai_import_batches where plan_id = $1) as batches,
         (select description from abstract_events where id = $2) as description,
         (select confidence::text from causal_relations where id = $3) as confidence`,
      [planId, existingCauseId, existingRelationId],
    );
    expect(state.rows[0]).toEqual({
      events: 3,
      cases: 2,
      relations: 2,
      links: 2,
      batches: 1,
      description: '更新后的港口作业说明',
      confidence: '19.0000',
    });
    const records = await pool.query<{
      record_type: string;
      action: string;
      detail: Record<string, unknown>;
    }>(
      `select record_type, action, detail
       from ai_import_records
       where batch_id = $1
       order by sequence`,
      [first.historyId],
    );
    expect(records.rows.map(({ record_type, action }) => ({ record_type, action }))).toEqual(
      expect.arrayContaining([
        { record_type: 'event', action: 'created' },
        { record_type: 'event', action: 'reused' },
        { record_type: 'event', action: 'updated' },
        { record_type: 'case', action: 'created' },
        { record_type: 'case', action: 'reused' },
        { record_type: 'relation', action: 'created' },
        { record_type: 'relation', action: 'reused' },
        { record_type: 'relation_case', action: 'created' },
        { record_type: 'confidence', action: 'changed' },
      ]),
    );
    for (const record of records.rows.filter(({ record_type }) =>
      ['relation', 'relation_case', 'confidence'].includes(record_type),
    )) {
      expect(record.detail).toMatchObject({
        causeEventName: expect.any(String),
        effectEventName: expect.any(String),
      });
    }
    for (const record of records.rows.filter(
      ({ record_type }) => record_type === 'relation_case',
    )) {
      expect(record.detail).toMatchObject({ caseContent: expect.any(String) });
    }

    await pool.query(`delete from causal_relation_cases where causal_relation_id = $1`, [
      existingRelationId,
    ]);
    await pool.query(`delete from causal_relations where id = $1`, [existingRelationId]);
    const preservedHistory = await pool.query<{ detail: Record<string, unknown> }>(
      `select detail
       from ai_import_records
       where batch_id = $1
         and record_type = 'confidence'
         and primary_record_id = $2`,
      [first.historyId, existingRelationId],
    );
    expect(preservedHistory.rows[0]?.detail).toMatchObject({
      causeEventName: '港口停止作业',
      effectEventName: '零部件到货延迟',
      relationDescription: '既有关系',
    });
  });

  it('commits a no-change plan once even when two requests run concurrently', async () => {
    const planId = await insertPlan(pool, emptyMutations());

    const [first, second] = await Promise.all([service.commit(planId), service.commit(planId)]);

    expect(second).toEqual(first);
    expect(first.noChanges).toBe(true);
    const batches = await pool.query<{ count: number }>(
      `select count(*)::int as count from ai_import_batches where plan_id = $1`,
      [planId],
    );
    expect(batches.rows[0]?.count).toBe(1);
  });

  it('records an existing relation-case link as reused without changing confidence', async () => {
    await pool.query(
      `insert into causal_relation_cases (causal_relation_id, concrete_case_id)
       values ($1, $2)`,
      [existingRelationId, existingCaseId],
    );
    const linked = await pool.query<{ linked_at: Date }>(
      `select linked_at from causal_relation_cases
       where causal_relation_id = $1 and concrete_case_id = $2`,
      [existingRelationId, existingCaseId],
    );
    const mutations = emptyMutations();
    mutations.reuseCases = [{ ref: 'case-existing', id: existingCaseId }];
    mutations.reuseRelations = [{ ref: 'relation-existing', id: existingRelationId }];
    mutations.dependencies = [
      {
        type: 'link',
        id: existingRelationId,
        relatedId: existingCaseId,
        fingerprint: fingerprintDependency({
          relationId: existingRelationId,
          caseId: existingCaseId,
          exists: true,
          linkedAt: linked.rows[0]!.linked_at.toISOString(),
        }),
      },
    ];
    mutations.summary = {
      ...emptyCounts,
      caseReused: 1,
      relationReused: 1,
      relationCaseReused: 1,
    };
    const planId = await insertPlan(pool, mutations);

    const result = await service.commit(planId);

    expect(result).toMatchObject({
      noChanges: true,
      counts: {
        caseReused: 1,
        relationReused: 1,
        relationCaseCreated: 0,
        relationCaseReused: 1,
        confidenceChanged: 0,
      },
    });
    const history = await pool.query<{
      relation_case_reused: number;
      confidence_changed: number;
      action: string;
    }>(
      `select batch.relation_case_reused, batch.confidence_changed, record.action
       from ai_import_batches batch
       join ai_import_records record on record.batch_id = batch.id
       where batch.plan_id = $1 and record.record_type = 'relation_case'`,
      [planId],
    );
    expect(history.rows).toEqual([
      { relation_case_reused: 1, confidence_changed: 0, action: 'reused' },
    ]);
  });

  it('rolls back every business mutation when successful-history creation fails', async () => {
    const mutations = emptyMutations();
    mutations.createEvents = [
      {
        ref: 'event-created',
        name: '不会保留的事件',
        description: null,
        aliases: [],
        keywords: [],
      },
    ];
    mutations.summary = { ...emptyCounts, eventCreated: 1 };
    const planId = await insertPlan(pool, mutations);
    await pool.query(
      `create function reject_test_ai_import_history()
       returns trigger
       language plpgsql
       as $$
       begin
         raise exception 'injected history failure' using errcode = '23514';
       end;
       $$`,
    );
    await pool.query(
      `create trigger reject_test_ai_import_history_trigger
       before insert on ai_import_batches
       for each row execute function reject_test_ai_import_history()`,
    );
    try {
      await expect(service.commit(planId)).rejects.toBeInstanceOf(AiImportCommitError);
    } finally {
      await pool.query(`drop trigger reject_test_ai_import_history_trigger on ai_import_batches`);
      await pool.query(`drop function reject_test_ai_import_history()`);
    }

    const state = await pool.query<{ events: number; batches: number; status: string }>(
      `select
         (select count(*)::int from abstract_events where name = '不会保留的事件') as events,
         (select count(*)::int from ai_import_batches where plan_id = $1) as batches,
         (select status from ai_import_plans where id = $1) as status`,
      [planId],
    );
    expect(state.rows[0]).toEqual({ events: 0, batches: 0, status: 'data_failed' });
  });

  it('stores a repairable data failure when a unique value changes after preparation', async () => {
    const mutations = emptyMutations();
    mutations.createEvents = [
      {
        ref: 'event-created',
        name: '准备后发生冲突',
        description: null,
        aliases: [],
        keywords: [],
      },
    ];
    mutations.summary = { ...emptyCounts, eventCreated: 1 };
    const planId = await insertPlan(pool, mutations);
    await pool.query(`insert into abstract_events (name) values ('准备后发生冲突')`);

    const error = await service.commit(planId).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AiImportCommitError);
    expect((error as AiImportCommitError).workflowError).toMatchObject({
      category: 'data',
      aiCanRepair: true,
      retryCurrentPlan: false,
    });
    const stored = await pool.query<{ status: string; result_payload: AiWorkflowError }>(
      `select status, result_payload from ai_import_plans where id = $1`,
      [planId],
    );
    expect(stored.rows[0]).toMatchObject({
      status: 'data_failed',
      result_payload: { category: 'data' },
    });
    await expect(service.commit(planId)).rejects.toMatchObject({
      workflowError: { retryCurrentPlan: false },
    });
  });

  it('invalidates an unexpired plan when a fingerprinted dependency changes', async () => {
    const event = await pool.query<{
      id: string;
      name: string;
      description: string | null;
      aliases: string[];
      keywords: string[];
      updated_at: Date;
    }>(
      `select id, name, description, array[]::varchar[] as aliases,
              array[]::varchar[] as keywords, updated_at
       from abstract_events where id = $1`,
      [existingCauseId],
    );
    const current = event.rows[0]!;
    const mutations = emptyMutations();
    mutations.reuseEvents = [{ ref: 'event-cause', id: existingCauseId }];
    mutations.dependencies = [
      {
        type: 'event',
        id: existingCauseId,
        relatedId: null,
        fingerprint: fingerprintDependency({
          id: current.id,
          name: current.name,
          description: current.description,
          aliases: current.aliases,
          keywords: current.keywords,
          updatedAt: current.updated_at.toISOString(),
        }),
      },
    ];
    mutations.summary = { ...emptyCounts, eventReused: 1 };
    const planId = await insertPlan(pool, mutations);
    await pool.query(
      `update abstract_events set description = '并发修改', updated_at = clock_timestamp()
       where id = $1`,
      [existingCauseId],
    );

    await expect(service.commit(planId)).rejects.toMatchObject({
      workflowError: { code: 'AI_PLAN_DEPENDENCY_CHANGED', category: 'data' },
    });
    const status = await pool.query<{ status: string }>(
      `select status from ai_import_plans where id = $1`,
      [planId],
    );
    expect(status.rows[0]?.status).toBe('data_failed');
  });

  it('rejects expired and superseded plans without applying their mutations', async () => {
    const mutations = emptyMutations();
    mutations.createEvents = [
      {
        ref: 'event-created',
        name: '不应写入的旧方案事件',
        description: null,
        aliases: [],
        keywords: [],
      },
    ];
    mutations.summary = { ...emptyCounts, eventCreated: 1 };
    const expiredId = await insertPlan(pool, mutations);
    await pool.query(
      `update ai_import_plans
       set created_at = '2020-07-28T12:00:00.000Z',
           expires_at = '2020-07-28T12:30:00.000Z'
       where id = $1`,
      [expiredId],
    );
    const oldId = await insertPlan(pool, mutations, {
      id: '40000000-0000-4000-8000-000000000001',
    });
    await insertPlan(pool, emptyMutations(), {
      id: '40000000-0000-4000-8000-000000000002',
      version: 2,
      replacesPlanId: oldId,
    });

    await expect(service.commit(expiredId)).rejects.toMatchObject({
      workflowError: { code: 'AI_PLAN_EXPIRED' },
    });
    await expect(service.commit(oldId)).rejects.toMatchObject({
      workflowError: { code: 'AI_PLAN_NOT_LATEST' },
    });
    const state = await pool.query<{ events: number; batches: number }>(
      `select
         (select count(*)::int from abstract_events where name = '不应写入的旧方案事件') as events,
         (select count(*)::int from ai_import_batches
          where plan_id in ($1, $2)) as batches`,
      [expiredId, oldId],
    );
    expect(state.rows[0]).toEqual({ events: 0, batches: 0 });
  });

  it('records an existing relation-case link as reused without deleting or recreating it', async () => {
    await pool.query(
      `insert into causal_relation_cases (causal_relation_id, concrete_case_id)
       values ($1, $2)`,
      [existingRelationId, existingCaseId],
    );
    const linked = await pool.query<{ linked_at: Date }>(
      `select linked_at from causal_relation_cases
       where causal_relation_id = $1 and concrete_case_id = $2`,
      [existingRelationId, existingCaseId],
    );
    const mutations = emptyMutations();
    mutations.reuseEvents = [
      { ref: 'event-cause', id: existingCauseId },
      { ref: 'event-effect', id: existingEffectId },
    ];
    mutations.reuseCases = [{ ref: 'case-existing', id: existingCaseId }];
    mutations.reuseRelations = [{ ref: 'relation-existing', id: existingRelationId }];
    mutations.dependencies = [
      {
        type: 'link',
        id: existingRelationId,
        relatedId: existingCaseId,
        fingerprint: fingerprintDependency({
          relationId: existingRelationId,
          caseId: existingCaseId,
          exists: true,
          linkedAt: linked.rows[0]!.linked_at.toISOString(),
        }),
      },
    ];
    mutations.summary = {
      ...emptyCounts,
      eventReused: 2,
      caseReused: 1,
      relationReused: 1,
    };
    const planId = await insertPlan(pool, mutations);

    const result = await service.commit(planId);

    expect(result.noChanges).toBe(true);
    const state = await pool.query<{ links: number; records: number }>(
      `select
         (select count(*)::int from causal_relation_cases
          where causal_relation_id = $1 and concrete_case_id = $2) as links,
         (select count(*)::int from ai_import_records
          where batch_id = $3
            and record_type = 'relation_case'
            and action = 'reused') as records`,
      [existingRelationId, existingCaseId, result.historyId],
    );
    expect(state.rows[0]).toEqual({ links: 1, records: 1 });
  });

  it('persists a transient system failure and retries the same still-valid plan exactly once', async () => {
    const mutations = emptyMutations();
    mutations.createEvents = [
      {
        ref: 'event-created',
        name: '系统恢复后写入',
        description: null,
        aliases: [],
        keywords: [],
      },
    ];
    mutations.summary = { ...emptyCounts, eventCreated: 1 };
    const planId = await insertPlan(pool, mutations);
    await pool.query(`create sequence transient_ai_commit_failure_sequence`);
    await pool.query(
      `create function reject_first_test_ai_event()
       returns trigger
       language plpgsql
       as $$
       begin
         if nextval('transient_ai_commit_failure_sequence') = 1 then
           raise exception 'transient test system failure' using errcode = 'P0001';
         end if;
         return new;
       end;
       $$`,
    );
    await pool.query(
      `create trigger reject_first_test_ai_event_trigger
       before insert on abstract_events
       for each row execute function reject_first_test_ai_event()`,
    );
    try {
      await expect(service.commit(planId)).rejects.toMatchObject({
        workflowError: {
          category: 'system',
          code: 'AI_COMMIT_SYSTEM_FAILURE',
          retryCurrentPlan: true,
        },
      });
      const failed = await pool.query<{ status: string }>(
        `select status from ai_import_plans where id = $1`,
        [planId],
      );
      expect(failed.rows[0]?.status).toBe('system_failed');

      const result = await service.commit(planId);
      const repeated = await service.commit(planId);
      expect(repeated).toEqual(result);
    } finally {
      await pool.query(`drop trigger reject_first_test_ai_event_trigger on abstract_events`);
      await pool.query(`drop function reject_first_test_ai_event()`);
      await pool.query(`drop sequence transient_ai_commit_failure_sequence`);
    }

    const state = await pool.query<{ events: number; batches: number }>(
      `select
         (select count(*)::int from abstract_events where name = '系统恢复后写入') as events,
         (select count(*)::int from ai_import_batches where plan_id = $1) as batches`,
      [planId],
    );
    expect(state.rows[0]).toEqual({ events: 1, batches: 1 });
  });
});
