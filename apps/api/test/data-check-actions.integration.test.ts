import type {
  DataCheckActionContext,
  DataCheckActionResponse,
  DataCheckIssue,
  DataCheckRecheckResponse,
} from '@causality/contracts';
import type { Pool } from 'pg';
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

describe.sequential('typed data-check governance actions', () => {
  let context: Awaited<ReturnType<typeof startPostgresTestContext>> | undefined;
  let pool: Pool | undefined;

  beforeAll(async () => {
    context = await startPostgresTestContext('causality_data_check_actions_test');
    ({ pool } = context);
    await pool.query(`drop index causal_relations_direction_uidx`);
    await pool.query(`drop index abstract_events_normalized_name_uidx`);
    await pool.query(`drop index concrete_cases_content_uidx`);
    await pool.query(`drop index event_keywords_event_normalized_uidx`);
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
    issueType: string;
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

  async function postAction(
    issueId: string,
    payload: Record<string, unknown>,
  ): Promise<ReturnType<NonNullable<typeof context>['app']['inject']>> {
    return context!.app.inject({
      method: 'POST',
      url: `/api/data-checks/issues/${issueId}/actions`,
      payload,
    });
  }

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
    expect(changedContext.dialogKind).toBe('merge');
    expect(changedContext.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: eventA, primaryText: '最新事件名称', relationCount: 1 }),
      ]),
    );
    expect(changedContext.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'merge', keepId: eventA, mergeId: eventB }),
        expect.objectContaining({ type: 'merge', keepId: eventB, mergeId: eventA }),
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
      status: 'handled',
      actions: [],
    });
  });

  it('disables stale actions until recheck and exposes a safe unknown-type fallback', async () => {
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
      dialogKind: 'merge',
      status: 'open',
      actions: [],
      message: '数据已变化，请重新检查此问题',
    });

    await pool!.query(`delete from data_check_issues`);
    const unknownIssue = 'b2000000-0000-4000-8000-000000000011';
    await currentIssue({
      issueId: unknownIssue,
      issueType: 'future_issue',
      targetType: 'event',
      targetId: eventA,
    });
    const unknown = await context!.app.inject({
      method: 'GET',
      url: `/api/data-checks/issues/${unknownIssue}/action-context?snapshotId=${snapshotId}`,
    });
    expect(unknown.json<DataCheckActionContext>()).toMatchObject({
      dialogKind: 'edit',
      actions: [{ type: 'open_edit', editPath: `/events/${eventA}` }, { type: 'ignore' }],
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
    expect(malformedContext.actions.some((option) => option.type === 'open_edit')).toBe(false);
    expect(malformedContext.message).toContain('详情页');

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

  it('suppresses strict detail actions for records the current detail contracts cannot load', async () => {
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
    await pool!.query(
      `insert into event_aliases (id, event_id, alias) values ($1, $2, '   ')`,
      [aliasId, eventB],
    );
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
      expect(actionContext.actions.some((option) => option.type === 'open_edit')).toBe(false);
      expect(actionContext.message).toContain('详情页');
    }

    const rechecked = await context!.app.inject({
      method: 'POST',
      url: `/api/data-checks/issues/${cases[0].issueId}/recheck`,
      payload: { snapshotId },
    });
    expect(rechecked.statusCode).toBe(200);
    expect(rechecked.json<DataCheckRecheckResponse>()).toMatchObject({
      status: 'open',
      context: {
        records: [expect.objectContaining({ id: eventA, primaryText: '   ' })],
        message: expect.stringContaining('详情页'),
      },
    });

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

    const loadableFallbackCases = [
      {
        issueId: 'b2000000-0000-4000-8000-00000000001b',
        targetType: 'alias',
        targetId: validAliasId,
        editPath: `/events/${eventD}`,
      },
      {
        issueId: 'b2000000-0000-4000-8000-00000000001c',
        targetType: 'keyword',
        targetId: validKeywordId,
        editPath: `/events/${eventD}`,
      },
      {
        issueId: 'b2000000-0000-4000-8000-00000000001d',
        targetType: 'relation_case',
        targetId: relationB,
        relatedId: caseB,
        editPath: `/relations/${relationB}`,
      },
    ] as const;

    for (const values of loadableFallbackCases) {
      await currentIssue({
        ...values,
        issueType: 'future_unknown_data_check',
      });
      const response = await context!.app.inject({
        method: 'GET',
        url: `/api/data-checks/issues/${values.issueId}/action-context?snapshotId=${snapshotId}`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<DataCheckActionContext>()).toMatchObject({
        actions: expect.arrayContaining([
          expect.objectContaining({ type: 'open_edit', editPath: values.editPath }),
        ]),
        message: null,
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
        [
          relationA,
          keepId,
          eventC,
          relationB,
          mergeId,
          relationC,
          eventD,
          relationD,
          relationE,
        ],
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
      expect(
        (
          await pool!.query(`select id::text from abstract_events where id in ($1, $2) order by id`, [
            keepId,
            mergeId,
          ])
        ).rows,
      ).toEqual([{ id: keepId }]);
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
      expect(
        await pool!.query(`select count(*)::int as count from concrete_cases`),
      ).toMatchObject({ rows: [{ count: 3 }] });
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

  it('merges duplicate case and relation links with deduplication', async () => {
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

    const caseIssue = 'b2000000-0000-4000-8000-000000000030';
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
          keepId: caseA,
          mergeId: caseB,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await pool!.query(`select count(*)::int as count from concrete_cases`)).rows[0]?.count,
    ).toBe(1);
    expect(
      (
        await pool!.query(
          `select causal_relation_id::text as relation_id
           from causal_relation_cases where concrete_case_id = $1 order by causal_relation_id`,
          [caseA],
        )
      ).rows,
    ).toEqual([{ relation_id: relationA }, { relation_id: relationB }, { relation_id: relationC }]);

    await pool!.query(`delete from data_check_issues`);
    const relationIssue = 'b2000000-0000-4000-8000-000000000031';
    await currentIssue({
      issueId: relationIssue,
      issueType: 'duplicate_relation_direction',
      targetType: 'relation',
      targetId: relationA,
      relatedId: relationC,
    });
    expect(
      (
        await postAction(relationIssue, {
          type: 'merge',
          snapshotId,
          keepId: relationA,
          mergeId: relationC,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await pool!.query(
          `select causal_relation_id::text as relation_id
           from causal_relation_cases where concrete_case_id = $1 order by causal_relation_id`,
          [caseA],
        )
      ).rows,
    ).toEqual([{ relation_id: relationA }, { relation_id: relationB }]);
  });

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
    expect(
      results.map((result) => ({ statusCode: result.statusCode, body: result.body })),
    ).toEqual(
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
      (await pool!.query(`select count(*)::int as count from abstract_events where id = $1`, [eventC]))
        .rows[0]?.count,
    ).toBe(1);

    await pool!.query(`delete from data_check_issues`);
    await pool!.query(`insert into abstract_events (id, name) values ($1, '恢复第四事件')`, [eventD]);
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
      (await pool!.query(`select count(*)::int as count from abstract_events where id = $1`, [eventD]))
        .rows[0]?.count,
    ).toBe(1);
  });

  it('applies whitelisted cleanup, deletion, timestamp repair, ignore, and single-issue recheck', async () => {
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
      (await pool!.query(`select count(*)::int as count from event_aliases where id = $1`, [aliasId]))
        .rows[0]?.count,
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
    await pool!.query(`update abstract_events set updated_at = created_at - interval '1 day' where id = $1`, [
      eventC,
    ]);
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
      issueType: 'future_issue',
      targetType: 'event',
      targetId: eventD,
    });
    expect(
      (await postAction(ignoredIssue, { type: 'ignore', snapshotId })).json<DataCheckActionResponse>()
        .issue.status,
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
    expect(open.json<DataCheckRecheckResponse>().status).toBe('open');
    await pool!.query(`update abstract_events set name = '已改变名称' where id = $1`, [eventD]);
    const resolved = await context!.app.inject({
      method: 'POST',
      url: `/api/data-checks/issues/${recheckIssue}/recheck`,
      payload: { snapshotId },
    });
    expect(resolved.json<DataCheckRecheckResponse>()).toMatchObject({
      status: 'resolved',
      issue: { status: 'handled' },
      context: null,
    });
    const stale = await context!.app.inject({
      method: 'POST',
      url: `/api/data-checks/issues/${recheckIssue}/recheck`,
      payload: { snapshotId: 'a2000000-0000-4000-8000-000000000099' },
    });
    expect(stale.statusCode).toBe(409);

    await pool!.query(`delete from data_check_issues`);
    const missingIssue = 'b2000000-0000-4000-8000-000000000055';
    await currentIssue({
      issueId: missingIssue,
      issueType: 'future_issue',
      targetType: 'event',
      targetId: eventC,
    });
    await pool!.query(`delete from abstract_events where id = $1`, [eventC]);
    const missing = await context!.app.inject({
      method: 'POST',
      url: `/api/data-checks/issues/${missingIssue}/recheck`,
      payload: { snapshotId },
    });
    expect(missing.json<DataCheckRecheckResponse>()).toMatchObject({
      status: 'resolved',
      issue: { status: 'handled' },
      context: null,
    });
  });
});
