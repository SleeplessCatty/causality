import type {
  DataCheckActionContext,
  DataCheckActionResponse,
  DataCheckIssue,
} from '@causality/contracts';
import type { Pool, PoolClient } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { startPostgresTestContext } from './support/postgresTestContext.js';

const snapshotId = 'a2000000-0000-4000-8000-000000000001';
const eventA = '12000000-0000-4000-8000-000000000001';
const eventB = '12000000-0000-4000-8000-000000000002';
const eventC = '12000000-0000-4000-8000-000000000003';
const eventD = '12000000-0000-4000-8000-000000000004';
const caseA = '32000000-0000-4000-8000-000000000001';
const caseB = '32000000-0000-4000-8000-000000000002';
const caseC = '32000000-0000-4000-8000-000000000003';
const relationA = '22000000-0000-4000-8000-000000000001';
const relationB = '22000000-0000-4000-8000-000000000002';
const relationC = '22000000-0000-4000-8000-000000000003';
const relationD = '22000000-0000-4000-8000-000000000004';
const relationE = '22000000-0000-4000-8000-000000000005';
const fixedActionCases = [
  ['delete_missing_alias', 'cleanup'],
  ['delete_missing_keyword', 'cleanup'],
  ['delete_missing_relation_case', 'cleanup'],
  ['delete_duplicate_alias', 'cleanup'],
  ['delete_duplicate_keyword', 'cleanup'],
  ['resequence_keywords', 'cleanup'],
  ['relation_self_loop', 'delete_relation'],
  ['missing_relation_cause_event', 'delete_relation'],
  ['missing_relation_effect_event', 'delete_relation'],
  ['invalid_event_timestamp_order', 'repair_timestamp'],
  ['invalid_relation_timestamp_order', 'repair_timestamp'],
  ['invalid_case_timestamp_order', 'repair_timestamp'],
] as const satisfies readonly (readonly [
  DataCheckIssue['issueType'],
  'cleanup' | 'delete_relation' | 'repair_timestamp',
])[];

describe.sequential('typed data-check governance actions', () => {
  let context: Awaited<ReturnType<typeof startPostgresTestContext>> | undefined;
  let pool: Pool | undefined;

  beforeAll(async () => {
    context = await startPostgresTestContext('causality_data_check_actions_test');
    ({ pool } = context);
    await pool.query(`drop index causal_relations_direction_uidx`);
    await pool.query(`drop index abstract_events_normalized_name_uidx`);
    await pool.query(`drop index concrete_cases_content_uidx`);
    await pool.query(`drop index event_aliases_event_normalized_uidx`);
    await pool.query(`drop index event_keywords_event_normalized_uidx`);
    await pool.query(`drop index event_keywords_event_position_uidx`);
    await pool.query(
      `alter table causal_relations
         drop constraint causal_relations_no_self_loop_check,
         drop constraint causal_relations_confidence_check`,
    );
    await pool.query(
      `alter table abstract_events
         drop constraint abstract_events_name_length_check,
         drop constraint abstract_events_description_check`,
    );
    await pool.query(`alter table concrete_cases drop constraint concrete_cases_content_check`);
    await pool.query(`alter table event_aliases drop constraint event_aliases_alias_length_check`);
    await pool.query(`alter table event_keywords drop constraint event_keywords_length_check`);
  }, 120_000);

  afterEach(async () => {
    await pool!.query(`
      truncate table
        data_check_issues,
        causal_relation_cases,
        event_aliases,
        event_keywords,
        causal_relations,
        concrete_cases,
        abstract_events
      restart identity cascade
    `);
    await pool!.query(`
      update data_check_state
      set status = 'never_run',
          last_snapshot_id = null,
          last_success_at = null,
          open_count = 0,
          handled_count = 0,
          error_count = 0,
          warning_count = 0,
          semantic_status = null,
          semantic_reason = null
      where singleton_key = true
    `);
  });

  afterAll(async () => {
    await context?.close();
  });

  async function currentIssue(values: {
    issueId: string;
    issueType: DataCheckIssue['issueType'];
    targetType: DataCheckIssue['targetType'];
    targetId: string;
    relatedId?: string | null;
    status?: DataCheckIssue['status'];
  }): Promise<void> {
    await pool!.query(
      `insert into data_check_issues (
         id, snapshot_id, severity, issue_type, description, suggestion,
         action_mode, status, target_type, target_id, related_id, handled_at
       ) values (
         $1, $2, 'error', $3, '测试治理问题', '执行类型化治理操作',
         'manual', $7::text, $4, $5, $6,
         case when $7::text = 'handled' then now() else null end
       )`,
      [
        values.issueId,
        snapshotId,
        values.issueType,
        values.targetType,
        values.targetId,
        values.relatedId ?? null,
        values.status ?? 'open',
      ],
    );
    await pool!.query(
      `update data_check_state
       set status = 'succeeded',
           last_snapshot_id = $1,
           last_success_at = now(),
           error_count = 1,
           open_count = case when $2 = 'handled' then 0 else 1 end,
           handled_count = case when $2 = 'handled' then 1 else 0 end,
           semantic_status = 'skipped',
           semantic_reason = 'not_recorded'
       where singleton_key = true`,
      [snapshotId, values.status ?? 'open'],
    );
  }

  async function insertEvents(): Promise<void> {
    await pool!.query(
      `insert into abstract_events (id, name, description) values
       ($1, '保留事件', '保留说明'),
       ($2, '合并事件', '合并说明'),
       ($3, '第三事件', null),
       ($4, '第四事件', null)`,
      [eventA, eventB, eventC, eventD],
    );
    await pool!.query(
      `insert into event_aliases (event_id, alias) values ($1, '共享治理别名'), ($2, '共享治理别名')`,
      [eventA, eventB],
    );
  }

  async function runWithDisabledReferences(
    work: (client: PoolClient) => Promise<void>,
  ): Promise<void> {
    const corruptionClient = await pool!.connect();
    try {
      await corruptionClient.query(`set session_replication_role = replica`);
      await work(corruptionClient);
    } finally {
      await corruptionClient.query(`set session_replication_role = origin`);
      corruptionClient.release();
    }
  }

  async function insertFixedActionFixture(
    issueType: (typeof fixedActionCases)[number][0],
  ): Promise<string> {
    const index = fixedActionCases.findIndex(([candidate]) => candidate === issueType);
    const issueId = `b2000000-0000-4000-8000-${String(index + 80).padStart(12, '0')}`;
    const aliasTarget = '42000000-0000-4000-8000-000000000080';
    const aliasRetained = '42000000-0000-4000-8000-000000000081';
    const keywordTarget = '52000000-0000-4000-8000-000000000080';
    const keywordRetained = '52000000-0000-4000-8000-000000000081';
    let targetType: DataCheckIssue['targetType'];
    let targetId: string;
    let relatedId: string | null = null;

    switch (issueType) {
      case 'delete_missing_alias':
        await pool!.query(`insert into abstract_events (id, name) values ($1, '待失效事件')`, [
          eventA,
        ]);
        await pool!.query(
          `insert into event_aliases (id, event_id, alias) values ($1, $2, '失效别名')`,
          [aliasTarget, eventA],
        );
        await runWithDisabledReferences(async (client) => {
          await client.query(`delete from abstract_events where id = $1`, [eventA]);
        });
        targetType = 'alias';
        targetId = aliasTarget;
        break;
      case 'delete_missing_keyword':
        await pool!.query(`insert into abstract_events (id, name) values ($1, '待失效事件')`, [
          eventA,
        ]);
        await pool!.query(
          `insert into event_keywords (id, event_id, keyword, position)
           values ($1, $2, '失效关键词', 1)`,
          [keywordTarget, eventA],
        );
        await runWithDisabledReferences(async (client) => {
          await client.query(`delete from abstract_events where id = $1`, [eventA]);
        });
        targetType = 'keyword';
        targetId = keywordTarget;
        break;
      case 'delete_missing_relation_case':
        await pool!.query(
          `insert into abstract_events (id, name) values ($1, '原因事件'), ($2, '结果事件')`,
          [eventA, eventC],
        );
        await pool!.query(
          `insert into causal_relations (id, cause_event_id, effect_event_id, confidence)
           values ($1, $2, $3, 50)`,
          [relationA, eventA, eventC],
        );
        await pool!.query(`insert into concrete_cases (id, content) values ($1, '待失效案例')`, [
          caseA,
        ]);
        await pool!.query(
          `insert into causal_relation_cases (causal_relation_id, concrete_case_id)
           values ($1, $2)`,
          [relationA, caseA],
        );
        await runWithDisabledReferences(async (client) => {
          await client.query(`delete from concrete_cases where id = $1`, [caseA]);
        });
        targetType = 'relation_case';
        targetId = relationA;
        relatedId = caseA;
        break;
      case 'delete_duplicate_alias':
        await pool!.query(`insert into abstract_events (id, name) values ($1, '重复别名事件')`, [
          eventA,
        ]);
        await pool!.query(
          `insert into event_aliases (id, event_id, alias, created_at) values
           ($1, $3, '重复别名', now()),
           ($2, $3, '重复别名', now() + interval '1 second')`,
          [aliasRetained, aliasTarget, eventA],
        );
        targetType = 'alias';
        targetId = aliasTarget;
        relatedId = aliasRetained;
        break;
      case 'delete_duplicate_keyword':
        await pool!.query(`insert into abstract_events (id, name) values ($1, '重复关键词事件')`, [
          eventA,
        ]);
        await pool!.query(
          `insert into event_keywords (id, event_id, keyword, position) values
           ($1, $3, '重复关键词', 1),
           ($2, $3, '重复关键词', 2)`,
          [keywordRetained, keywordTarget, eventA],
        );
        targetType = 'keyword';
        targetId = keywordTarget;
        relatedId = keywordRetained;
        break;
      case 'resequence_keywords':
        await pool!.query(`insert into abstract_events (id, name) values ($1, '关键词重排事件')`, [
          eventA,
        ]);
        await pool!.query(
          `insert into event_keywords (id, event_id, keyword, position) values
           ($1, $3, '关键词一', 2),
           ($2, $3, '关键词二', 4)`,
          [keywordRetained, keywordTarget, eventA],
        );
        targetType = 'event';
        targetId = eventA;
        break;
      case 'relation_self_loop':
        await pool!.query(`insert into abstract_events (id, name) values ($1, '自环事件')`, [
          eventA,
        ]);
        await pool!.query(`insert into concrete_cases (id, content) values ($1, '自环关系案例')`, [
          caseA,
        ]);
        await pool!.query(
          `insert into causal_relations (id, cause_event_id, effect_event_id, confidence)
           values ($1, $2, $2, 50)`,
          [relationA, eventA],
        );
        await pool!.query(
          `insert into causal_relation_cases (causal_relation_id, concrete_case_id)
           values ($1, $2)`,
          [relationA, caseA],
        );
        targetType = 'relation';
        targetId = relationA;
        break;
      case 'missing_relation_cause_event':
      case 'missing_relation_effect_event':
        await pool!.query(`insert into abstract_events (id, name) values ($1, '现存事件')`, [
          eventC,
        ]);
        await runWithDisabledReferences(async (client) => {
          await client.query(
            `insert into causal_relations (id, cause_event_id, effect_event_id, confidence)
             values ($1, $2, $3, 50)`,
            issueType === 'missing_relation_cause_event'
              ? [relationA, eventA, eventC]
              : [relationA, eventC, eventA],
          );
        });
        targetType = 'relation';
        targetId = relationA;
        relatedId = eventA;
        break;
      case 'invalid_event_timestamp_order':
        await pool!.query(
          `insert into abstract_events (id, name, created_at, updated_at)
           values
             ($1, '事件时间异常', now(), now() - interval '1 day'),
             ($2, '未处理事件时间异常', now(), now() - interval '2 days')`,
          [eventA, eventB],
        );
        targetType = 'event';
        targetId = eventA;
        break;
      case 'invalid_relation_timestamp_order':
        await pool!.query(
          `insert into abstract_events (id, name) values ($1, '原因事件'), ($2, '结果事件')`,
          [eventA, eventC],
        );
        await pool!.query(
          `insert into causal_relations
             (id, cause_event_id, effect_event_id, confidence, created_at, updated_at)
           values
             ($1, $3, $4, 50, now(), now() - interval '1 day'),
             ($2, $4, $3, 50, now(), now() - interval '2 days')`,
          [relationA, relationB, eventA, eventC],
        );
        targetType = 'relation';
        targetId = relationA;
        break;
      case 'invalid_case_timestamp_order':
        await pool!.query(
          `insert into concrete_cases (id, content, created_at, updated_at)
           values
             ($1, '案例时间异常', now(), now() - interval '1 day'),
             ($2, '未处理案例时间异常', now(), now() - interval '2 days')`,
          [caseA, caseB],
        );
        targetType = 'case';
        targetId = caseA;
        break;
    }

    await currentIssue({ issueId, issueType, targetType, targetId, relatedId });
    return issueId;
  }

  async function postAction(
    issueId: string,
    payload: Record<string, unknown>,
  ): Promise<ReturnType<NonNullable<typeof context>['app']['inject']>> {
    let authorizedPayload = payload;
    if (
      payload.type !== 'ignore' &&
      typeof payload.type === 'string' &&
      typeof payload.snapshotId === 'string' &&
      typeof payload.actionKey !== 'string'
    ) {
      const response = await context!.app.inject({
        method: 'GET',
        url: `/api/data-checks/issues/${issueId}/action-context?snapshotId=${payload.snapshotId}`,
      });
      const actionContext = response.json<DataCheckActionContext>();
      const option = actionContext.actions.find(
        (candidate) =>
          candidate.type === payload.type &&
          (candidate.type !== 'merge' ||
            (candidate.keepId === payload.keepId && candidate.mergeId === payload.mergeId)),
      );
      authorizedPayload = {
        ...payload,
        actionKey: option?.actionKey ?? '0'.repeat(64),
      };
    }
    return context!.app.inject({
      method: 'POST',
      url: `/api/data-checks/issues/${issueId}/actions`,
      payload: authorizedPayload,
    });
  }

  async function recordExists(
    table: 'abstract_events' | 'concrete_cases' | 'causal_relations',
    id: string,
  ): Promise<boolean> {
    const result = await pool!.query<{ exists: boolean }>(
      `select exists(select 1 from ${table} where id = $1) as exists`,
      [id],
    );
    return result.rows[0]?.exists ?? false;
  }

  async function issueStatus(id: string): Promise<string | undefined> {
    const result = await pool!.query<{ status: string }>(
      `select status from data_check_issues where id = $1`,
      [id],
    );
    return result.rows[0]?.status;
  }

  async function duplicateRelationCaseLinkCount(): Promise<number> {
    const result = await pool!.query<{ count: number }>(
      `select count(*)::int as count
       from (
         select causal_relation_id, concrete_case_id
         from causal_relation_cases
         group by causal_relation_id, concrete_case_id
         having count(*) > 1
       ) duplicate_links`,
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  it.each(fixedActionCases)(
    'offers one authorized %s plan as %s plus snapshot-only ignore',
    async (issueType, actionType) => {
      const issueId = await insertFixedActionFixture(issueType);
      const response = await context!.app.inject({
        method: 'GET',
        url: `/api/data-checks/issues/${issueId}/action-context?snapshotId=${snapshotId}`,
      });
      expect(response.statusCode).toBe(200);
      const actionContext = response.json<DataCheckActionContext>();
      expect(actionContext.actions.map((option) => option.type)).toEqual([actionType, 'ignore']);
      const automaticAction = actionContext.actions[0]!;
      expect(automaticAction.actionKey).toMatch(/^[0-9a-f]{64}$/);
      expect(actionContext.actions[1]?.actionKey).toBeNull();
      if (issueType === 'resequence_keywords') {
        expect(automaticAction.impact.recordsUpdated).toBe(2);
      }
      if (actionType === 'delete_relation') {
        expect(automaticAction.impact.relationsDeleted).toBe(1);
      }

      const applied = await context!.app.inject({
        method: 'POST',
        url: `/api/data-checks/issues/${issueId}/actions`,
        payload: {
          type: actionType,
          snapshotId,
          actionKey: automaticAction.actionKey,
        },
      });
      expect(applied.statusCode, applied.body).toBe(200);
      expect(await issueStatus(issueId)).toBe('handled');

      switch (issueType) {
        case 'delete_missing_alias':
          expect(
            Number(
              (
                await pool!.query(
                  `select count(*)::int as count from event_aliases
                   where id = '42000000-0000-4000-8000-000000000080'`,
                )
              ).rows[0]?.count,
            ),
          ).toBe(0);
          break;
        case 'delete_missing_keyword':
          expect(
            Number(
              (
                await pool!.query(
                  `select count(*)::int as count from event_keywords
                   where id = '52000000-0000-4000-8000-000000000080'`,
                )
              ).rows[0]?.count,
            ),
          ).toBe(0);
          break;
        case 'delete_missing_relation_case':
          expect(
            Number(
              (
                await pool!.query(
                  `select count(*)::int as count
                   from causal_relation_cases
                   where causal_relation_id = $1 and concrete_case_id = $2`,
                  [relationA, caseA],
                )
              ).rows[0]?.count,
            ),
          ).toBe(0);
          expect(await recordExists('causal_relations', relationA)).toBe(true);
          break;
        case 'delete_duplicate_alias':
          expect(
            (
              await pool!.query(
                `select id::text
                 from event_aliases
                 where event_id = $1
                 order by id`,
                [eventA],
              )
            ).rows,
          ).toEqual([{ id: '42000000-0000-4000-8000-000000000081' }]);
          break;
        case 'delete_duplicate_keyword':
          expect(
            (
              await pool!.query(
                `select id::text, position
                 from event_keywords
                 where event_id = $1
                 order by position`,
                [eventA],
              )
            ).rows,
          ).toEqual([{ id: '52000000-0000-4000-8000-000000000081', position: 1 }]);
          break;
        case 'resequence_keywords':
          expect(
            (
              await pool!.query(
                `select position from event_keywords where event_id = $1 order by position`,
                [eventA],
              )
            ).rows,
          ).toEqual([{ position: 1 }, { position: 2 }]);
          break;
        case 'relation_self_loop':
          expect(await recordExists('causal_relations', relationA)).toBe(false);
          expect(await recordExists('abstract_events', eventA)).toBe(true);
          expect(await recordExists('concrete_cases', caseA)).toBe(true);
          expect(automaticAction.impact.relationCaseLinksDeleted).toBe(1);
          break;
        case 'missing_relation_cause_event':
        case 'missing_relation_effect_event':
          expect(await recordExists('causal_relations', relationA)).toBe(false);
          expect(await recordExists('abstract_events', eventC)).toBe(true);
          break;
        case 'invalid_event_timestamp_order':
          expect(
            await pool!.query(
              `select id::text, updated_at >= created_at as valid
               from abstract_events
               order by id`,
            ),
          ).toMatchObject({
            rows: [
              { id: eventA, valid: true },
              { id: eventB, valid: false },
            ],
          });
          break;
        case 'invalid_relation_timestamp_order':
          expect(
            await pool!.query(
              `select id::text, updated_at >= created_at as valid
               from causal_relations
               order by id`,
            ),
          ).toMatchObject({
            rows: [
              { id: relationA, valid: true },
              { id: relationB, valid: false },
            ],
          });
          break;
        case 'invalid_case_timestamp_order':
          expect(
            await pool!.query(
              `select id::text, updated_at >= created_at as valid
               from concrete_cases
               order by id`,
            ),
          ).toMatchObject({
            rows: [
              { id: caseA, valid: true },
              { id: caseB, valid: false },
            ],
          });
          break;
      }
    },
  );

  it('returns refreshed server-authorized context and closes handled or deleted targets', async () => {
    await insertEvents();
    const changedIssue = 'b2000000-0000-4000-8000-000000000001';
    await currentIssue({
      issueId: changedIssue,
      issueType: 'cross_event_shared_alias',
      targetType: 'event',
      targetId: eventA,
      relatedId: eventB,
    });
    await pool!.query(`update abstract_events set name = '最新事件名称' where id = $1`, [eventA]);
    await pool!.query(
      `insert into causal_relations (id, cause_event_id, effect_event_id, confidence)
       values ($1, $2, $3, 50)`,
      [relationA, eventA, eventC],
    );

    const changed = await context!.app.inject({
      method: 'GET',
      url: `/api/data-checks/issues/${changedIssue}/action-context?snapshotId=${snapshotId}`,
    });
    expect(changed.statusCode).toBe(200);
    const changedContext = changed.json<DataCheckActionContext>();
    expect(changedContext.panelKind).toBe('merge');
    expect(changedContext.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: eventA, primaryText: '最新事件名称', relationCount: 1 }),
      ]),
    );
    expect(changedContext.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'merge', keepId: eventA, mergeId: eventB }),
        expect.objectContaining({ type: 'merge', keepId: eventB, mergeId: eventA }),
        expect.objectContaining({ type: 'ignore', actionKey: null }),
      ]),
    );

    await pool!.query(`delete from data_check_issues`);
    const handledIssue = 'b2000000-0000-4000-8000-000000000002';
    await currentIssue({
      issueId: handledIssue,
      issueType: 'cross_event_shared_alias',
      targetType: 'event',
      targetId: eventA,
      relatedId: eventB,
      status: 'handled',
    });
    const handled = await context!.app.inject({
      method: 'GET',
      url: `/api/data-checks/issues/${handledIssue}/action-context?snapshotId=${snapshotId}`,
    });
    expect(handled.json<DataCheckActionContext>()).toMatchObject({
      status: 'handled',
      actions: [],
      message: '此问题已处理',
    });

    await pool!.query(`delete from data_check_issues`);
    const deletedIssue = 'b2000000-0000-4000-8000-000000000003';
    await currentIssue({
      issueId: deletedIssue,
      issueType: 'cross_event_shared_alias',
      targetType: 'event',
      targetId: eventA,
      relatedId: eventB,
    });
    await pool!.query(`delete from causal_relations`);
    await pool!.query(`delete from abstract_events where id = $1`, [eventA]);
    const deleted = await context!.app.inject({
      method: 'GET',
      url: `/api/data-checks/issues/${deletedIssue}/action-context?snapshotId=${snapshotId}`,
    });
    expect(deleted.json<DataCheckActionContext>()).toMatchObject({
      status: 'open',
      actions: [],
      message: expect.stringContaining('完整数据检查'),
    });
    expect(
      (
        await pool!.query<{ status: string }>(
          `select status from data_check_issues where id = $1`,
          [deletedIssue],
        )
      ).rows[0]?.status,
    ).toBe('open');
  });

  it('rejects an action key after relevant context data changes', async () => {
    await pool!.query(
      `insert into abstract_events (id, name) values ($1, '重复名称'), ($2, '重复名称')`,
      [eventA, eventB],
    );
    const issueId = 'b2000000-0000-4000-8000-000000000009';
    await currentIssue({
      issueId,
      issueType: 'duplicate_event_name',
      targetType: 'event',
      targetId: eventA,
      relatedId: eventB,
    });
    const contextResponse = await context!.app.inject({
      method: 'GET',
      url: `/api/data-checks/issues/${issueId}/action-context?snapshotId=${snapshotId}`,
    });
    const merge = contextResponse
      .json<DataCheckActionContext>()
      .actions.find(
        (option) =>
          option.type === 'merge' && option.keepId === eventA && option.mergeId === eventB,
      );
    expect(merge?.actionKey).toMatch(/^[0-9a-f]{64}$/);

    await pool!.query(`update abstract_events set description = '已变化' where id = $1`, [eventA]);
    const response = await context!.app.inject({
      method: 'POST',
      url: `/api/data-checks/issues/${issueId}/actions`,
      payload: {
        type: 'merge',
        snapshotId,
        keepId: eventA,
        mergeId: eventB,
        actionKey: merge!.actionKey,
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'DATA_CHECK_ACTION_CONFLICT' });
  });

  it.each(['name', 'alias', 'keyword', 'relation', 'case_link'] as const)(
    'invalidates event-merge authorization after a %s change',
    async (changedPart) => {
      await insertEvents();
      if (changedPart === 'case_link') {
        await pool!.query(
          `insert into causal_relations (id, cause_event_id, effect_event_id, confidence)
           values ($1, $2, $3, 50)`,
          [relationA, eventA, eventC],
        );
        await pool!.query(`insert into concrete_cases (id, content) values ($1, '新增关联案例')`, [
          caseA,
        ]);
      }
      const issueIdByPart = {
        name: 'b2000000-0000-4000-8000-000000000070',
        alias: 'b2000000-0000-4000-8000-000000000071',
        keyword: 'b2000000-0000-4000-8000-000000000072',
        relation: 'b2000000-0000-4000-8000-000000000073',
        case_link: 'b2000000-0000-4000-8000-000000000074',
      } as const;
      const issueId = issueIdByPart[changedPart];
      await currentIssue({
        issueId,
        issueType: 'cross_event_shared_alias',
        targetType: 'event',
        targetId: eventA,
        relatedId: eventB,
      });
      const actionContext = (
        await context!.app.inject({
          method: 'GET',
          url: `/api/data-checks/issues/${issueId}/action-context?snapshotId=${snapshotId}`,
        })
      ).json<DataCheckActionContext>();
      const merge = actionContext.actions.find(
        (option) =>
          option.type === 'merge' && option.keepId === eventA && option.mergeId === eventB,
      );
      expect(merge?.actionKey).toMatch(/^[0-9a-f]{64}$/);

      switch (changedPart) {
        case 'name':
          await pool!.query(`update abstract_events set name = '变化后的事件名' where id = $1`, [
            eventA,
          ]);
          break;
        case 'alias':
          await pool!.query(
            `insert into event_aliases (event_id, alias) values ($1, '新增事件别名')`,
            [eventA],
          );
          break;
        case 'keyword':
          await pool!.query(
            `insert into event_keywords (event_id, keyword, position)
             values ($1, '新增关键词', 1)`,
            [eventA],
          );
          break;
        case 'relation':
          await pool!.query(
            `insert into causal_relations (id, cause_event_id, effect_event_id, confidence)
             values ($1, $2, $3, 50)`,
            [relationA, eventA, eventC],
          );
          break;
        case 'case_link':
          await pool!.query(
            `insert into causal_relation_cases (causal_relation_id, concrete_case_id)
             values ($1, $2)`,
            [relationA, caseA],
          );
          break;
      }

      const response = await context!.app.inject({
        method: 'POST',
        url: `/api/data-checks/issues/${issueId}/actions`,
        payload: {
          type: 'merge',
          snapshotId,
          keepId: eventA,
          mergeId: eventB,
          actionKey: merge!.actionKey,
        },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: 'DATA_CHECK_ACTION_CONFLICT' });
      expect(await issueStatus(issueId)).toBe('open');
      expect(await recordExists('abstract_events', eventB)).toBe(true);
    },
  );

  it('disables stale actions until the next full check', async () => {
    await pool!.query(
      `insert into abstract_events (id, name) values ($1, '重复名称'), ($2, '重复名称')`,
      [eventA, eventB],
    );
    const issueId = 'b2000000-0000-4000-8000-000000000010';
    await currentIssue({
      issueId,
      issueType: 'duplicate_event_name',
      targetType: 'event',
      targetId: eventA,
      relatedId: eventB,
    });
    await pool!.query(`update abstract_events set name = '不再重复' where id = $1`, [eventA]);
    const stale = await context!.app.inject({
      method: 'GET',
      url: `/api/data-checks/issues/${issueId}/action-context?snapshotId=${snapshotId}`,
    });
    expect(stale.json<DataCheckActionContext>()).toMatchObject({
      panelKind: 'merge',
      status: 'open',
      actions: [],
      message: '数据已变化，请重新执行完整数据检查',
    });
  });

  it('returns malformed live text and dangling relation-case records without serialization failure', async () => {
    await pool!.query(
      `insert into abstract_events (id, name, description) values ($1, '   ', '   ')`,
      [eventA],
    );
    const malformedIssue = 'b2000000-0000-4000-8000-000000000012';
    await currentIssue({
      issueId: malformedIssue,
      issueType: 'invalid_event_name',
      targetType: 'event',
      targetId: eventA,
    });
    const malformed = await context!.app.inject({
      method: 'GET',
      url: `/api/data-checks/issues/${malformedIssue}/action-context?snapshotId=${snapshotId}`,
    });
    expect(malformed.statusCode).toBe(200);
    const malformedContext = malformed.json<DataCheckActionContext>();
    expect(malformedContext.records).toEqual([
      expect.objectContaining({ id: eventA, primaryText: '   ', secondaryText: ['   '] }),
    ]);
    expect(malformedContext.actions).toEqual([
      expect.objectContaining({ type: 'ignore', actionKey: null }),
    ]);
    expect(malformedContext.message).toBeNull();

    await pool!.query(`delete from data_check_issues`);
    await pool!.query(`insert into concrete_cases (id, content) values ($1, '仍存在的案例')`, [
      caseA,
    ]);
    const missingRelationId = '22000000-0000-4000-8000-000000000099';
    const corruptionClient = await pool!.connect();
    try {
      await corruptionClient.query(`set session_replication_role = replica`);
      await corruptionClient.query(
        `insert into causal_relation_cases (causal_relation_id, concrete_case_id)
         values ($1, $2)`,
        [missingRelationId, caseA],
      );
      await corruptionClient.query(`set session_replication_role = origin`);
    } finally {
      corruptionClient.release();
    }
    const danglingIssue = 'b2000000-0000-4000-8000-000000000013';
    await currentIssue({
      issueId: danglingIssue,
      issueType: 'delete_missing_relation_case',
      targetType: 'relation_case',
      targetId: missingRelationId,
      relatedId: caseA,
    });
    const dangling = await context!.app.inject({
      method: 'GET',
      url: `/api/data-checks/issues/${danglingIssue}/action-context?snapshotId=${snapshotId}`,
    });
    expect(dangling.statusCode).toBe(200);
    const danglingContext = dangling.json<DataCheckActionContext>();
    expect(danglingContext.records).toEqual([
      expect.objectContaining({ id: missingRelationId, targetType: 'relation_case' }),
    ]);
    expect(danglingContext.actions).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'cleanup' })]),
    );
  });

  it('keeps malformed records readable without creating edit actions', async () => {
    await pool!.query(
      `insert into abstract_events (id, name) values
       ($1, '   '),
       ($2, '可加载事件'),
       ($3, '另一个可加载事件')`,
      [eventA, eventB, eventC],
    );
    await pool!.query(`insert into concrete_cases (id, content) values ($1, '   ')`, [caseA]);
    const aliasId = '42000000-0000-4000-8000-000000000010';
    const keywordId = '52000000-0000-4000-8000-000000000010';
    await pool!.query(`insert into event_aliases (id, event_id, alias) values ($1, $2, '   ')`, [
      aliasId,
      eventB,
    ]);
    await pool!.query(
      `insert into event_keywords (id, event_id, keyword, position) values ($1, $2, '   ', 1)`,
      [keywordId, eventC],
    );
    await pool!.query(
      `insert into causal_relations (id, cause_event_id, effect_event_id, confidence) values
       ($1, $2, $3, 150)`,
      [relationA, eventB, eventC],
    );
    const missingCauseRelation = '22000000-0000-4000-8000-000000000011';
    const missingEffectRelation = '22000000-0000-4000-8000-000000000012';
    const missingEvent = '12000000-0000-4000-8000-000000000099';
    const corruptionClient = await pool!.connect();
    try {
      await corruptionClient.query(`set session_replication_role = replica`);
      await corruptionClient.query(
        `insert into causal_relations
           (id, cause_event_id, effect_event_id, confidence)
         values ($1, $2, $3, 50), ($4, $3, $2, 50)`,
        [missingCauseRelation, missingEvent, eventB, missingEffectRelation],
      );
      await corruptionClient.query(`set session_replication_role = origin`);
    } finally {
      corruptionClient.release();
    }

    const cases = [
      {
        issueId: 'b2000000-0000-4000-8000-000000000014',
        issueType: 'invalid_event_name',
        targetType: 'event',
        targetId: eventA,
      },
      {
        issueId: 'b2000000-0000-4000-8000-000000000015',
        issueType: 'invalid_case_content',
        targetType: 'case',
        targetId: caseA,
      },
      {
        issueId: 'b2000000-0000-4000-8000-000000000016',
        issueType: 'invalid_alias_text',
        targetType: 'alias',
        targetId: aliasId,
      },
      {
        issueId: 'b2000000-0000-4000-8000-000000000017',
        issueType: 'invalid_keyword_text',
        targetType: 'keyword',
        targetId: keywordId,
      },
      {
        issueId: 'b2000000-0000-4000-8000-000000000018',
        issueType: 'relation_confidence_range',
        targetType: 'relation',
        targetId: relationA,
      },
      {
        issueId: 'b2000000-0000-4000-8000-000000000019',
        issueType: 'missing_relation_cause_event',
        targetType: 'relation',
        targetId: missingCauseRelation,
        relatedId: missingEvent,
      },
      {
        issueId: 'b2000000-0000-4000-8000-00000000001a',
        issueType: 'missing_relation_effect_event',
        targetType: 'relation',
        targetId: missingEffectRelation,
        relatedId: missingEvent,
      },
    ] as const;

    for (const values of cases) {
      await currentIssue(values);
      const response = await context!.app.inject({
        method: 'GET',
        url: `/api/data-checks/issues/${values.issueId}/action-context?snapshotId=${snapshotId}`,
      });
      expect(response.statusCode).toBe(200);
      const actionContext = response.json<DataCheckActionContext>();
      expect(actionContext.records).not.toEqual([]);
      expect(
        actionContext.actions.every((option) =>
          ['ignore', 'delete_relation'].includes(option.type),
        ),
      ).toBe(true);
      expect(actionContext.message).toBeNull();
    }

    const rechecked = await context!.app.inject({
      method: 'POST',
      url: `/api/data-checks/issues/${cases[0].issueId}/recheck`,
      payload: { snapshotId },
    });
    expect(rechecked.statusCode).toBe(404);

    await pool!.query(`insert into abstract_events (id, name) values ($1, '完整详情事件')`, [
      eventD,
    ]);
    const validAliasId = '42000000-0000-4000-8000-000000000011';
    const validKeywordId = '52000000-0000-4000-8000-000000000011';
    await pool!.query(
      `insert into event_aliases (id, event_id, alias) values ($1, $2, '可加载别名')`,
      [validAliasId, eventD],
    );
    await pool!.query(
      `insert into event_keywords (id, event_id, keyword, position)
       values ($1, $2, '可加载关键词', 1)`,
      [validKeywordId, eventD],
    );
    await pool!.query(
      `insert into causal_relations (id, cause_event_id, effect_event_id, confidence)
       values ($1, $2, $3, 50)`,
      [relationB, eventB, eventC],
    );
    await pool!.query(`insert into concrete_cases (id, content) values ($1, '可加载关联案例')`, [
      caseB,
    ]);
    await pool!.query(
      `insert into causal_relation_cases (causal_relation_id, concrete_case_id)
       values ($1, $2)`,
      [relationB, caseB],
    );

    const resolvedCases = [
      {
        issueId: 'b2000000-0000-4000-8000-00000000001b',
        issueType: 'invalid_alias_text',
        targetType: 'alias',
        targetId: validAliasId,
      },
      {
        issueId: 'b2000000-0000-4000-8000-00000000001c',
        issueType: 'invalid_keyword_text',
        targetType: 'keyword',
        targetId: validKeywordId,
      },
      {
        issueId: 'b2000000-0000-4000-8000-00000000001d',
        issueType: 'delete_missing_relation_case',
        targetType: 'relation_case',
        targetId: relationB,
        relatedId: caseB,
      },
    ] as const;

    for (const values of resolvedCases) {
      await currentIssue(values);
      const response = await context!.app.inject({
        method: 'GET',
        url: `/api/data-checks/issues/${values.issueId}/action-context?snapshotId=${snapshotId}`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<DataCheckActionContext>()).toMatchObject({
        actions: [],
        message: expect.stringContaining('完整数据检查'),
      });
    }
  });

  it('re-sequences reverse physical keyword rows and post-delete gaps without unique collisions', async () => {
    await pool!.query(
      `insert into abstract_events (id, name) values ($1, '关键词重排事件'), ($2, '删除后重排事件')`,
      [eventA, eventB],
    );
    const keyword1 = '52000000-0000-4000-8000-000000000021';
    const keyword2 = '52000000-0000-4000-8000-000000000022';
    const keyword3 = '52000000-0000-4000-8000-000000000023';
    await pool!.query(
      `insert into event_keywords (id, event_id, keyword, position) values
       ($1, $4, '位置七', 7),
       ($2, $4, '位置四', 4),
       ($3, $4, '位置二', 2)`,
      [keyword1, keyword2, keyword3, eventA],
    );
    const resequenceIssue = 'b2000000-0000-4000-8000-000000000060';
    await currentIssue({
      issueId: resequenceIssue,
      issueType: 'resequence_keywords',
      targetType: 'event',
      targetId: eventA,
    });
    const resequenced = await postAction(resequenceIssue, { type: 'cleanup', snapshotId });
    expect(resequenced.statusCode).toBe(200);
    expect(
      (
        await pool!.query(
          `select id::text, position from event_keywords where event_id = $1 order by position`,
          [eventA],
        )
      ).rows,
    ).toEqual([
      { id: keyword3, position: 1 },
      { id: keyword2, position: 2 },
      { id: keyword1, position: 3 },
    ]);

    await pool!.query(`delete from data_check_issues`);
    const retainedKeyword = '52000000-0000-4000-8000-000000000031';
    const otherKeyword = '52000000-0000-4000-8000-000000000032';
    const duplicateKeyword = '52000000-0000-4000-8000-000000000033';
    await pool!.query(
      `insert into event_keywords (id, event_id, keyword, position) values
       ($2, $4, '其他词', 3),
       ($3, $4, '重复词', 4),
       ($1, $4, '重复词', 2)`,
      [retainedKeyword, otherKeyword, duplicateKeyword, eventB],
    );
    const duplicateIssue = 'b2000000-0000-4000-8000-000000000061';
    await currentIssue({
      issueId: duplicateIssue,
      issueType: 'delete_duplicate_keyword',
      targetType: 'keyword',
      targetId: duplicateKeyword,
      relatedId: retainedKeyword,
    });
    const deleted = await postAction(duplicateIssue, { type: 'cleanup', snapshotId });
    expect(deleted.statusCode).toBe(200);
    expect(
      (
        await pool!.query(
          `select id::text, position from event_keywords where event_id = $1 order by position`,
          [eventB],
        )
      ).rows,
    ).toEqual([
      { id: retainedKeyword, position: 1 },
      { id: otherKeyword, position: 2 },
    ]);
  });

  it.each(['duplicate', 'over_limit'] as const)(
    'rolls back unsafe keyword resequencing for %s data',
    async (failureKind) => {
      await pool!.query(`insert into abstract_events (id, name) values ($1, '拒绝重排事件')`, [
        eventA,
      ]);
      if (failureKind === 'duplicate') {
        await pool!.query(
          `insert into event_keywords (event_id, keyword, position) values
           ($1, '重复词', 2),
           ($1, '重复词', 4)`,
          [eventA],
        );
      } else {
        await pool!.query(
          `insert into event_keywords (event_id, keyword, position)
           select $1::uuid, '关键词' || number, (number % 20) + 1
           from generate_series(1, 21) number`,
          [eventA],
        );
      }
      const before = (
        await pool!.query(
          `select keyword, position
           from event_keywords
           where event_id = $1
           order by position, id`,
          [eventA],
        )
      ).rows;
      const issueId =
        failureKind === 'duplicate'
          ? 'b2000000-0000-4000-8000-000000000092'
          : 'b2000000-0000-4000-8000-000000000093';
      await currentIssue({
        issueId,
        issueType: 'resequence_keywords',
        targetType: 'event',
        targetId: eventA,
      });

      const response = await postAction(issueId, { type: 'cleanup', snapshotId });
      expect(response.statusCode).toBe(409);
      expect(await issueStatus(issueId)).toBe('open');
      expect(
        (
          await pool!.query(
            `select keyword, position
             from event_keywords
             where event_id = $1
             order by position, id`,
            [eventA],
          )
        ).rows,
      ).toEqual(before);
    },
  );

  it('rejects an incorrect fixed-action key without changing data', async () => {
    const issueId = await insertFixedActionFixture('delete_missing_alias');
    const response = await context!.app.inject({
      method: 'POST',
      url: `/api/data-checks/issues/${issueId}/actions`,
      payload: {
        type: 'cleanup',
        snapshotId,
        actionKey: '0'.repeat(64),
      },
    });
    expect(response.statusCode).toBe(409);
    expect(await issueStatus(issueId)).toBe('open');
    expect(
      Number(
        (
          await pool!.query(
            `select count(*)::int as count
             from event_aliases
             where id = '42000000-0000-4000-8000-000000000080'`,
          )
        ).rows[0]?.count,
      ),
    ).toBe(1);
  });

  it.each(['before_issue_status', 'after_issue_status'] as const)(
    'rolls back fixed-action business changes on a forced failure %s update',
    async (failurePoint) => {
      const issueId = await insertFixedActionFixture('delete_missing_alias');
      const functionName =
        failurePoint === 'before_issue_status'
          ? 'fail_before_issue_status_update'
          : 'fail_after_issue_status_update';
      const triggerName = `${functionName}_trigger`;
      const table =
        failurePoint === 'before_issue_status' ? 'data_check_issues' : 'data_check_state';
      const condition =
        failurePoint === 'before_issue_status'
          ? `new.id = '${issueId}'::uuid and new.status = 'handled'`
          : `new.handled_count > old.handled_count`;
      await pool!.query(`
        create function ${functionName}() returns trigger language plpgsql as $$
        begin
          if ${condition} then
            raise exception 'forced fixed-action failure';
          end if;
          return new;
        end
        $$;
        create trigger ${triggerName}
        before update on ${table}
        for each row execute function ${functionName}();
      `);

      let response: Awaited<ReturnType<typeof postAction>>;
      try {
        response = await postAction(issueId, { type: 'cleanup', snapshotId });
      } finally {
        await pool!.query(`
          drop trigger ${triggerName} on ${table};
          drop function ${functionName}();
        `);
      }

      expect(response!.statusCode).toBe(500);
      expect(await issueStatus(issueId)).toBe('open');
      expect(
        Number(
          (
            await pool!.query(
              `select count(*)::int as count
               from event_aliases
               where id = '42000000-0000-4000-8000-000000000080'`,
            )
          ).rows[0]?.count,
        ),
      ).toBe(1);
      expect(
        await pool!.query(
          `select open_count, handled_count from data_check_state where singleton_key = true`,
        ),
      ).toMatchObject({ rows: [{ open_count: 1, handled_count: 0 }] });
    },
  );

  it('ignores only the current snapshot issue and leaves business data unchanged', async () => {
    await pool!.query(
      `insert into abstract_events (id, name, description)
       values ($1, '忽略测试事件', null)`,
      [eventA],
    );
    const issueId = 'b2000000-0000-4000-8000-000000000094';
    await currentIssue({
      issueId,
      issueType: 'invalid_event_description',
      targetType: 'event',
      targetId: eventA,
    });
    const before = (
      await pool!.query(
        `select name, description, created_at, updated_at from abstract_events where id = $1`,
        [eventA],
      )
    ).rows;

    const response = await postAction(issueId, { type: 'ignore', snapshotId });
    expect(response.statusCode).toBe(200);
    expect(await issueStatus(issueId)).toBe('handled');
    expect(
      await pool!.query(
        `select name, description, created_at, updated_at from abstract_events where id = $1`,
        [eventA],
      ),
    ).toMatchObject({ rows: before });
    expect(
      await pool!.query(
        `select open_count, handled_count from data_check_state where singleton_key = true`,
      ),
    ).toMatchObject({ rows: [{ open_count: 0, handled_count: 1 }] });
  });

  it.each([
    [eventA, eventB],
    [eventB, eventA],
  ] as const)(
    'merges events in either explicit direction with collision, self-loop, and case-link preservation',
    async (keepId, mergeId) => {
      await insertEvents();
      await pool!.query(
        `insert into concrete_cases (id, content) values
         ($1, '共享案例'), ($2, '被迁移案例'), ($3, '自环案例')`,
        [caseA, caseB, caseC],
      );
      await pool!.query(
        `insert into event_keywords (event_id, keyword, position) values
         ($1, '保留关键词一', 1),
         ($1, '保留关键词二', 3),
         ($2, '迁移关键词', 1)`,
        [keepId, mergeId],
      );
      await pool!.query(
        `insert into causal_relations (id, cause_event_id, effect_event_id, confidence) values
         ($1, $2, $3, 80),
         ($4, $5, $3, 70),
         ($6, $5, $7, 60),
         ($8, $2, $5, 50),
         ($9, $3, $5, 40)`,
        [relationA, keepId, eventC, relationB, mergeId, relationC, eventD, relationD, relationE],
      );
      await pool!.query(
        `insert into causal_relation_cases (causal_relation_id, concrete_case_id) values
         ($1, $2), ($3, $2), ($3, $4), ($5, $6)`,
        [relationA, caseA, relationB, caseB, relationD, caseC],
      );
      const issueId =
        keepId === eventA
          ? 'b2000000-0000-4000-8000-000000000020'
          : 'b2000000-0000-4000-8000-000000000021';
      await currentIssue({
        issueId,
        issueType: 'cross_event_shared_alias',
        targetType: 'event',
        targetId: eventA,
        relatedId: eventB,
      });

      const actionContext = (
        await context!.app.inject({
          method: 'GET',
          url: `/api/data-checks/issues/${issueId}/action-context?snapshotId=${snapshotId}`,
        })
      ).json<DataCheckActionContext>();
      expect(
        actionContext.actions.find(
          (option) =>
            option.type === 'merge' && option.keepId === keepId && option.mergeId === mergeId,
        ),
      ).toMatchObject({
        impact: {
          relationsMoved: 2,
          relationsDeleted: 2,
          relationCaseLinksMoved: 1,
          relationCaseLinksDeleted: 2,
          recordsDeleted: 1,
          recordsUpdated: 0,
        },
      });

      const response = await postAction(issueId, {
        type: 'merge',
        snapshotId,
        keepId,
        mergeId,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<DataCheckActionResponse>()).toMatchObject({
        issue: { status: 'handled' },
        affectedEventIds: expect.arrayContaining([keepId, mergeId]),
        affectedRelationIds: expect.arrayContaining([
          relationA,
          relationB,
          relationC,
          relationD,
          relationE,
        ]),
      });
      expect(await issueStatus(issueId)).toBe('handled');
      expect(await recordExists('abstract_events', mergeId)).toBe(false);
      expect(
        (
          await pool!.query(
            `select id::text from abstract_events where id in ($1, $2) order by id`,
            [keepId, mergeId],
          )
        ).rows,
      ).toEqual([{ id: keepId }]);
      expect(
        Number(
          (
            await pool!.query(
              `select count(*)::int as count
               from causal_relations
               where cause_event_id = $1 or effect_event_id = $1`,
              [mergeId],
            )
          ).rows[0]?.count,
        ),
      ).toBe(0);
      expect(
        await pool!.query(
          `select count(*)::int as count from causal_relations
           where cause_event_id = effect_event_id`,
        ),
      ).toMatchObject({ rows: [{ count: 0 }] });
      expect(
        (
          await pool!.query(
            `select concrete_case_id::text as case_id
             from causal_relation_cases where causal_relation_id = $1 order by concrete_case_id`,
            [relationA],
          )
        ).rows,
      ).toEqual([{ case_id: caseA }, { case_id: caseB }]);
      expect(await pool!.query(`select count(*)::int as count from concrete_cases`)).toMatchObject({
        rows: [{ count: 3 }],
      });
      expect(
        Number(
          (
            await pool!.query(
              `select count(*)::int as count
               from (
                 select normalized_alias
                 from event_aliases
                 where event_id = $1
                 group by normalized_alias
                 having count(*) > 1
               ) duplicate_aliases`,
              [keepId],
            )
          ).rows[0]?.count,
        ),
      ).toBe(0);
      expect(
        (
          await pool!.query(
            `select position from event_keywords where event_id = $1 order by position`,
            [keepId],
          )
        ).rows,
      ).toEqual([{ position: 1 }, { position: 2 }, { position: 3 }]);
    },
  );

  it.each(['alias', 'keyword'] as const)(
    'rolls back the whole event merge when combined %s values exceed 20',
    async (valueType) => {
      await insertEvents();
      if (valueType === 'alias') {
        await pool!.query(
          `insert into event_aliases (event_id, alias)
           select $1::uuid, '保留别名' || number from generate_series(1, 10) number
           union all
           select $2::uuid, '合并别名' || number from generate_series(1, 10) number`,
          [eventA, eventB],
        );
      } else {
        await pool!.query(
          `insert into event_keywords (event_id, keyword, position)
           select $1::uuid, '保留关键词' || number, number from generate_series(1, 11) number
           union all
           select $2::uuid, '合并关键词' || number, number from generate_series(1, 10) number`,
          [eventA, eventB],
        );
      }
      await pool!.query(
        `insert into causal_relations (id, cause_event_id, effect_event_id, confidence)
         values ($1, $2, $3, 50)`,
        [relationA, eventB, eventC],
      );
      const issueId =
        valueType === 'alias'
          ? 'b2000000-0000-4000-8000-000000000075'
          : 'b2000000-0000-4000-8000-000000000076';
      await currentIssue({
        issueId,
        issueType: 'cross_event_shared_alias',
        targetType: 'event',
        targetId: eventA,
        relatedId: eventB,
      });

      const response = await postAction(issueId, {
        type: 'merge',
        snapshotId,
        keepId: eventA,
        mergeId: eventB,
      });
      expect(response.statusCode).toBe(409);
      expect(await issueStatus(issueId)).toBe('open');
      expect(await recordExists('abstract_events', eventB)).toBe(true);
      expect(
        await pool!.query(
          `select cause_event_id::text, effect_event_id::text
           from causal_relations
           where id = $1`,
          [relationA],
        ),
      ).toMatchObject({ rows: [{ cause_event_id: eventB, effect_event_id: eventC }] });
    },
  );

  it('rolls back relation migration and issue handling after a forced late exception', async () => {
    await insertEvents();
    await pool!.query(
      `insert into causal_relations (id, cause_event_id, effect_event_id, confidence)
       values ($1, $2, $3, 50)`,
      [relationA, eventB, eventC],
    );
    const issueId = 'b2000000-0000-4000-8000-000000000077';
    await currentIssue({
      issueId,
      issueType: 'cross_event_shared_alias',
      targetType: 'event',
      targetId: eventA,
      relatedId: eventB,
    });
    await pool!.query(`
      create function fail_late_event_merge() returns trigger language plpgsql as $$
      begin
        if old.id = '${eventB}'::uuid then
          raise exception 'forced late merge failure';
        end if;
        return old;
      end
      $$;
      create trigger fail_late_event_merge_trigger
      before delete on abstract_events
      for each row execute function fail_late_event_merge();
    `);

    const response = await postAction(issueId, {
      type: 'merge',
      snapshotId,
      keepId: eventA,
      mergeId: eventB,
    });
    await pool!.query(`
      drop trigger fail_late_event_merge_trigger on abstract_events;
      drop function fail_late_event_merge();
    `);

    expect(response.statusCode).toBe(500);
    expect(await issueStatus(issueId)).toBe('open');
    expect(await recordExists('abstract_events', eventB)).toBe(true);
    expect(
      await pool!.query(
        `select cause_event_id::text, effect_event_id::text
         from causal_relations
         where id = $1`,
        [relationA],
      ),
    ).toMatchObject({ rows: [{ cause_event_id: eventB, effect_event_id: eventC }] });
  });

  it.each([
    [caseA, caseB, relationA, relationC],
    [caseB, caseA, relationC, relationA],
  ] as const)(
    'merges cases and same-direction relations in either explicit direction',
    async (keepCaseId, mergeCaseId, keepRelationId, mergeRelationId) => {
      await insertEvents();
      await pool!.query(
        `insert into concrete_cases (id, content) values
       ($1, '重复案例'), ($2, '重复案例')`,
        [caseA, caseB],
      );
      await pool!.query(
        `insert into causal_relations (id, cause_event_id, effect_event_id, confidence) values
       ($1, $2, $3, 50), ($4, $2, $5, 50), ($6, $2, $3, 40)`,
        [relationA, eventA, eventC, relationB, eventD, relationC],
      );
      await pool!.query(
        `insert into causal_relation_cases (causal_relation_id, concrete_case_id) values
       ($1, $2), ($1, $3), ($4, $3), ($5, $2), ($6, $3)`,
        [relationA, caseA, caseB, relationB, relationC, relationC],
      );

      const caseIssue =
        keepCaseId === caseA
          ? 'b2000000-0000-4000-8000-000000000030'
          : 'b2000000-0000-4000-8000-000000000032';
      await currentIssue({
        issueId: caseIssue,
        issueType: 'duplicate_case_content',
        targetType: 'case',
        targetId: caseA,
        relatedId: caseB,
      });
      expect(
        (
          await postAction(caseIssue, {
            type: 'merge',
            snapshotId,
            keepId: keepCaseId,
            mergeId: mergeCaseId,
          })
        ).statusCode,
      ).toBe(200);
      expect(await recordExists('concrete_cases', mergeCaseId)).toBe(false);
      expect(await issueStatus(caseIssue)).toBe('handled');
      expect(await duplicateRelationCaseLinkCount()).toBe(0);
      expect(
        (
          await pool!.query(
            `select causal_relation_id::text as relation_id
           from causal_relation_cases where concrete_case_id = $1 order by causal_relation_id`,
            [keepCaseId],
          )
        ).rows,
      ).toEqual([
        { relation_id: relationA },
        { relation_id: relationB },
        { relation_id: relationC },
      ]);

      await pool!.query(`delete from data_check_issues`);
      const relationIssue =
        keepRelationId === relationA
          ? 'b2000000-0000-4000-8000-000000000031'
          : 'b2000000-0000-4000-8000-000000000033';
      await currentIssue({
        issueId: relationIssue,
        issueType: 'duplicate_relation_direction',
        targetType: 'relation',
        targetId: relationA,
        relatedId: relationC,
      });
      const keptBefore = await pool!.query<{
        cause_event_id: string;
        effect_event_id: string;
        confidence: number;
        description: string | null;
      }>(
        `select cause_event_id::text, effect_event_id::text, confidence, description
       from causal_relations
       where id = $1`,
        [keepRelationId],
      );
      expect(
        (
          await postAction(relationIssue, {
            type: 'merge',
            snapshotId,
            keepId: keepRelationId,
            mergeId: mergeRelationId,
          })
        ).statusCode,
      ).toBe(200);
      expect(await recordExists('causal_relations', mergeRelationId)).toBe(false);
      expect(await issueStatus(relationIssue)).toBe('handled');
      expect(await duplicateRelationCaseLinkCount()).toBe(0);
      expect(
        await pool!.query(
          `select cause_event_id::text, effect_event_id::text, confidence, description
         from causal_relations
         where id = $1`,
          [keepRelationId],
        ),
      ).toMatchObject({ rows: keptBefore.rows });
    },
  );

  it('serializes opposite merge directions and rolls back stale membership', async () => {
    await insertEvents();
    const issueId = 'b2000000-0000-4000-8000-000000000040';
    await currentIssue({
      issueId,
      issueType: 'cross_event_shared_alias',
      targetType: 'event',
      targetId: eventA,
      relatedId: eventB,
    });
    const unrelated = await postAction(issueId, {
      type: 'merge',
      snapshotId,
      keepId: eventA,
      mergeId: eventC,
    });
    expect(unrelated.statusCode).toBe(409);
    const results = await Promise.all([
      postAction(issueId, {
        type: 'merge',
        snapshotId,
        keepId: eventA,
        mergeId: eventB,
      }),
      postAction(issueId, {
        type: 'merge',
        snapshotId,
        keepId: eventB,
        mergeId: eventA,
      }),
    ]);
    expect(results.map((result) => ({ statusCode: result.statusCode, body: result.body }))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ statusCode: 200 }),
        expect.objectContaining({ statusCode: 409 }),
      ]),
    );
    expect(
      (await pool!.query(`select count(*)::int as count from abstract_events`)).rows[0]?.count,
    ).toBe(3);

    await pool!.query(`delete from data_check_issues`);
    await pool!.query(
      `insert into event_aliases (event_id, alias) values ($1, '并发失效别名'), ($2, '并发失效别名')`,
      [eventC, eventD],
    );
    await pool!.query(`delete from abstract_events where id = $1`, [eventD]);
    const staleRelatedIssue = 'b2000000-0000-4000-8000-000000000041';
    await currentIssue({
      issueId: staleRelatedIssue,
      issueType: 'cross_event_shared_alias',
      targetType: 'event',
      targetId: eventC,
      relatedId: eventD,
    });
    const staleRelated = await postAction(staleRelatedIssue, {
      type: 'merge',
      snapshotId,
      keepId: eventC,
      mergeId: eventD,
    });
    expect(staleRelated.statusCode).toBe(409);
    expect(
      (
        await pool!.query(`select count(*)::int as count from abstract_events where id = $1`, [
          eventC,
        ])
      ).rows[0]?.count,
    ).toBe(1);

    await pool!.query(`delete from data_check_issues`);
    await pool!.query(`insert into abstract_events (id, name) values ($1, '恢复第四事件')`, [
      eventD,
    ]);
    await pool!.query(
      `insert into event_aliases (event_id, alias) values ($1, '目标失效别名'), ($2, '目标失效别名')`,
      [eventC, eventD],
    );
    await pool!.query(`delete from abstract_events where id = $1`, [eventC]);
    const staleTargetIssue = 'b2000000-0000-4000-8000-000000000042';
    await currentIssue({
      issueId: staleTargetIssue,
      issueType: 'cross_event_shared_alias',
      targetType: 'event',
      targetId: eventC,
      relatedId: eventD,
    });
    const staleTarget = await postAction(staleTargetIssue, {
      type: 'merge',
      snapshotId,
      keepId: eventD,
      mergeId: eventC,
    });
    expect(staleTarget.statusCode).toBe(409);
    expect(
      (
        await pool!.query(`select count(*)::int as count from abstract_events where id = $1`, [
          eventD,
        ])
      ).rows[0]?.count,
    ).toBe(1);
  });

  it('applies whitelisted cleanup, deletion, timestamp repair, and ignore', async () => {
    await insertEvents();
    const aliasId = '42000000-0000-4000-8000-000000000001';
    await pool!.query(`insert into event_aliases (id, event_id, alias) values ($1, $2, '待清理')`, [
      aliasId,
      eventA,
    ]);
    const cleanupIssue = 'b2000000-0000-4000-8000-000000000050';
    await currentIssue({
      issueId: cleanupIssue,
      issueType: 'delete_missing_alias',
      targetType: 'alias',
      targetId: aliasId,
    });
    // Simulate the corruption after the snapshot without accepting table names from the client.
    const corruptionClient = await pool!.connect();
    try {
      await corruptionClient.query(`set session_replication_role = replica`);
      await corruptionClient.query(`delete from abstract_events where id = $1`, [eventA]);
      await corruptionClient.query(`set session_replication_role = origin`);
    } finally {
      corruptionClient.release();
    }
    const cleanupResponse = await postAction(cleanupIssue, {
      type: 'cleanup',
      snapshotId,
    });
    expect(cleanupResponse.statusCode, cleanupResponse.body).toBe(200);
    expect(
      (
        await pool!.query(`select count(*)::int as count from event_aliases where id = $1`, [
          aliasId,
        ])
      ).rows[0]?.count,
    ).toBe(0);

    await pool!.query(`delete from data_check_issues`);
    const deleteIssue = 'b2000000-0000-4000-8000-000000000051';
    await pool!.query(
      `insert into causal_relations (id, cause_event_id, effect_event_id, confidence)
       values ($1, $2, $3, 50)`,
      [relationA, eventC, eventC],
    );
    await currentIssue({
      issueId: deleteIssue,
      issueType: 'relation_self_loop',
      targetType: 'relation',
      targetId: relationA,
    });
    expect(
      (
        await postAction(deleteIssue, {
          type: 'delete_relation',
          snapshotId,
        })
      ).statusCode,
    ).toBe(200);

    await pool!.query(`delete from data_check_issues`);
    const repairIssue = 'b2000000-0000-4000-8000-000000000052';
    await pool!.query(
      `update abstract_events set updated_at = created_at - interval '1 day' where id = $1`,
      [eventC],
    );
    await currentIssue({
      issueId: repairIssue,
      issueType: 'invalid_event_timestamp_order',
      targetType: 'event',
      targetId: eventC,
    });
    expect(
      (
        await postAction(repairIssue, {
          type: 'repair_timestamp',
          snapshotId,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await pool!.query<{ valid: boolean }>(
          `select updated_at >= created_at as valid from abstract_events where id = $1`,
          [eventC],
        )
      ).rows[0]?.valid,
    ).toBe(true);

    await pool!.query(`delete from data_check_issues`);
    const ignoredIssue = 'b2000000-0000-4000-8000-000000000053';
    await currentIssue({
      issueId: ignoredIssue,
      issueType: 'invalid_event_description',
      targetType: 'event',
      targetId: eventD,
    });
    expect(
      (
        await postAction(ignoredIssue, { type: 'ignore', snapshotId })
      ).json<DataCheckActionResponse>().issue.status,
    ).toBe('handled');
    expect(
      (
        await postAction(ignoredIssue, {
          type: 'cleanup',
          snapshotId,
          table: 'abstract_events',
        })
      ).statusCode,
    ).toBe(400);

    await pool!.query(`delete from data_check_issues`);
    const recheckIssue = 'b2000000-0000-4000-8000-000000000054';
    await pool!.query(`update abstract_events set name = '待复查名称' where id in ($1, $2)`, [
      eventC,
      eventD,
    ]);
    await currentIssue({
      issueId: recheckIssue,
      issueType: 'duplicate_event_name',
      targetType: 'event',
      targetId: eventC,
      relatedId: eventD,
    });
    const open = await context!.app.inject({
      method: 'POST',
      url: `/api/data-checks/issues/${recheckIssue}/recheck`,
      payload: { snapshotId },
    });
    expect(open.statusCode).toBe(404);
    await pool!.query(`update abstract_events set name = '已改变名称' where id = $1`, [eventD]);
    const resolved = await context!.app.inject({
      method: 'POST',
      url: `/api/data-checks/issues/${recheckIssue}/recheck`,
      payload: { snapshotId },
    });
    expect(resolved.statusCode).toBe(404);
    const stale = await context!.app.inject({
      method: 'POST',
      url: `/api/data-checks/issues/${recheckIssue}/recheck`,
      payload: { snapshotId: 'a2000000-0000-4000-8000-000000000099' },
    });
    expect(stale.statusCode).toBe(404);

    await pool!.query(`delete from data_check_issues`);
    const missingIssue = 'b2000000-0000-4000-8000-000000000055';
    await currentIssue({
      issueId: missingIssue,
      issueType: 'invalid_event_name',
      targetType: 'event',
      targetId: eventC,
    });
    await pool!.query(`delete from abstract_events where id = $1`, [eventC]);
    const missing = await context!.app.inject({
      method: 'POST',
      url: `/api/data-checks/issues/${missingIssue}/recheck`,
      payload: { snapshotId },
    });
    expect(missing.statusCode).toBe(404);

    for (const suffix of ['auto-handle', 'manual-handle']) {
      const legacy = await context!.app.inject({
        method: 'POST',
        url: `/api/data-checks/issues/${missingIssue}/${suffix}`,
        payload: { snapshotId },
      });
      expect(legacy.statusCode).toBe(404);
    }
  });
});
