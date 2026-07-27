import type {
  DataCheckIssueListResponse,
  DataCheckIssueType,
  DataCheckLatestResponse,
} from '@causality/contracts';
import type { Pool, PoolClient } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { PostgresDataCheckRepository } from '../src/features/data-checks/dataCheckRepository.js';
import { createDataCheckRules } from '../src/features/data-checks/dataCheckRules.js';
import type { DataCheckScanResult } from '../src/features/data-checks/dataCheckTypes.js';
import { startPostgresTestContext } from './support/postgresTestContext.js';

const snapshotId = 'a1000000-0000-4000-8000-000000000001';

describe.sequential('data-check REST API and rules', () => {
  let context: Awaited<ReturnType<typeof startPostgresTestContext>> | undefined;
  let pool: Pool | undefined;
  let app: ReturnType<typeof buildApp> | undefined;
  let corruptionClient: PoolClient | undefined;

  beforeAll(async () => {
    context = await startPostgresTestContext('causality_data_checks_test');
    ({ pool, app } = context);
  }, 120_000);

  afterEach(async () => {
    if (!corruptionClient) return;
    try {
      await corruptionClient.query('rollback');
      await corruptionClient.query('set session_replication_role = origin');
    } finally {
      corruptionClient.release();
      corruptionClient = undefined;
    }
  });

  afterAll(async () => {
    await context?.close();
  });

  async function waitForFinished(): Promise<DataCheckLatestResponse> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const response = await app!.inject({ method: 'GET', url: '/api/data-checks/latest' });
      const latest = response.json<DataCheckLatestResponse>();
      if (latest.task.status !== 'running') return latest;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Data check did not finish');
  }

  async function setCurrentSnapshot(
    currentSnapshotId: string,
    counts: { errors: number; warnings: number; open: number; handled?: number },
  ): Promise<void> {
    await pool!.query(
      `update data_check_state
       set status = 'succeeded',
           attempt_started_at = now() - interval '1 second',
           attempt_finished_at = now(),
           last_snapshot_id = $1,
           last_success_at = now(),
           error_count = $2,
           warning_count = $3,
           open_count = $4,
           handled_count = $5,
           semantic_status = 'skipped',
           semantic_reason = 'not_recorded',
           last_failure_at = null,
           last_failure_message = null
       where singleton_key = true`,
      [currentSnapshotId, counts.errors, counts.warnings, counts.open, counts.handled ?? 0],
    );
  }

  it('runs one asynchronous check and publishes orphan counts through the REST API', async () => {
    const causeId = '10000000-0000-4000-8000-000000000001';
    const effectId = '10000000-0000-4000-8000-000000000002';
    const caseId = '30000000-0000-4000-8000-000000000001';
    await pool!.query(
      `insert into abstract_events (id, name)
       values ($1, '数据检查原因'), ($2, '数据检查结果')`,
      [causeId, effectId],
    );
    await pool!.query(
      `insert into causal_relations (cause_event_id, effect_event_id, confidence)
       values ($1, $2, 50)`,
      [causeId, effectId],
    );
    await pool!.query(`insert into concrete_cases (id, content) values ($1, '未关联测试案例')`, [
      caseId,
    ]);

    const [first, second] = await Promise.all([
      app!.inject({ method: 'POST', url: '/api/data-checks' }),
      app!.inject({ method: 'POST', url: '/api/data-checks' }),
    ]);
    expect([first.statusCode, second.statusCode]).toEqual([202, 202]);
    expect([first.json().task.status, second.json().task.status]).toEqual(['running', 'running']);

    const latest = await waitForFinished();
    expect(latest).toMatchObject({
      task: { status: 'succeeded' },
      snapshot: {
        orphanEventCount: 0,
        orphanRelationCount: 1,
        orphanCaseCount: 1,
        errorCount: 0,
        warningCount: 0,
        semanticStatus: 'skipped',
        semanticReason: 'no_active_model',
      },
      latestFailure: null,
    });

    const issues = await app!.inject({
      method: 'GET',
      url: '/api/data-checks/latest/issues?page=1',
    });
    expect(issues.statusCode).toBe(200);
    expect(issues.json()).toMatchObject({
      items: [],
      page: 1,
      pageSize: 50,
      totalItems: 0,
      totalPages: 1,
    });
  });

  it('detects every deterministic rule family inside one rollback-only corruption transaction', async () => {
    corruptionClient = await pool!.connect();
    await corruptionClient.query('begin');
    await corruptionClient.query('set session_replication_role = replica');
    await corruptionClient.query(`
      alter table abstract_events
        drop constraint abstract_events_name_length_check,
        drop constraint abstract_events_description_check;
      drop index abstract_events_normalized_name_uidx;
      alter table causal_relations
        drop constraint causal_relations_no_self_loop_check,
        drop constraint causal_relations_confidence_check,
        drop constraint causal_relations_description_check;
      drop index causal_relations_direction_uidx;
      alter table concrete_cases drop constraint concrete_cases_content_check;
      drop index concrete_cases_content_uidx;
      alter table event_aliases drop constraint event_aliases_alias_length_check;
      drop index event_aliases_event_normalized_uidx;
      alter table event_keywords
        drop constraint event_keywords_length_check,
        drop constraint event_keywords_position_check;
      drop index event_keywords_event_normalized_uidx;
      drop index event_keywords_event_position_uidx;
    `);
    await corruptionClient.query(`
      insert into abstract_events (id, name, description, created_at, updated_at) values
        ('11000000-0000-4000-8000-000000000001', '重复事件', null, now(), now()),
        ('11000000-0000-4000-8000-000000000002', '重复事件', null, now(), now()),
        ('11000000-0000-4000-8000-000000000003', '标准事件', '   ', now(), now() - interval '1 day'),
        ('11000000-0000-4000-8000-000000000004', '其他事件', null, now(), now()),
        ('11000000-0000-4000-8000-000000000005', '   ', null, now(), now());

      insert into event_aliases (id, event_id, alias) values
        ('41000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000003', '共享别名'),
        ('41000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000003', '共享别名'),
        ('41000000-0000-4000-8000-000000000003', '11000000-0000-4000-8000-000000000004', '共享别名'),
        ('41000000-0000-4000-8000-000000000004', '11000000-0000-4000-8000-000000000004', '标准事件'),
        ('41000000-0000-4000-8000-000000000005', '11000000-0000-4000-8000-000000000099', '失效别名'),
        ('41000000-0000-4000-8000-000000000006', '11000000-0000-4000-8000-000000000004', '   ');

      insert into event_keywords (id, event_id, keyword, position) values
        ('51000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000003', '重复关键词', 1),
        ('51000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000003', '重复关键词', 3),
        ('51000000-0000-4000-8000-000000000003', '11000000-0000-4000-8000-000000000099', '失效关键词', 1),
        ('51000000-0000-4000-8000-000000000004', '11000000-0000-4000-8000-000000000004', '   ', 30);

      insert into causal_relations
        (id, cause_event_id, effect_event_id, confidence, description, created_at, updated_at)
      values
        ('21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000003', '11000000-0000-4000-8000-000000000003', 150, null, now(), now()),
        ('21000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000003', '11000000-0000-4000-8000-000000000004', 50, '   ', now(), now() - interval '1 day'),
        ('21000000-0000-4000-8000-000000000003', '11000000-0000-4000-8000-000000000003', '11000000-0000-4000-8000-000000000004', 60, null, now(), now()),
        ('21000000-0000-4000-8000-000000000004', '11000000-0000-4000-8000-000000000099', '11000000-0000-4000-8000-000000000004', 50, null, now(), now());

      insert into concrete_cases (id, content, created_at, updated_at) values
        ('31000000-0000-4000-8000-000000000001', '重复案例', now(), now()),
        ('31000000-0000-4000-8000-000000000002', '重复案例', now(), now() - interval '1 day'),
        ('31000000-0000-4000-8000-000000000003', '   ', now(), now());

      insert into causal_relation_cases (causal_relation_id, concrete_case_id) values
        ('21000000-0000-4000-8000-000000000099', '31000000-0000-4000-8000-000000000001'),
        ('21000000-0000-4000-8000-000000000002', '31000000-0000-4000-8000-000000000099');
    `);

    const draftsByRule = new Map<string, number>();
    for (const rule of createDataCheckRules()) {
      const drafts = await rule.scan(corruptionClient, snapshotId);
      draftsByRule.set(rule.issueType, drafts.length);
      expect(drafts.every((draft) => draft.description.length <= 300)).toBe(true);
      expect(drafts.every((draft) => draft.suggestion.length <= 300)).toBe(true);
      expect(drafts.every((draft) => !draft.description.includes('<'))).toBe(true);
    }

    expect([...draftsByRule.keys()]).toEqual([
      'missing_required_references',
      'relation_self_loop',
      'relation_confidence_range',
      'duplicate_relation_direction',
      'duplicate_event_name',
      'duplicate_case_content',
      'duplicate_event_alias',
      'duplicate_event_keyword',
      'invalid_required_text',
      'invalid_optional_text',
      'invalid_keyword_position',
      'invalid_timestamp_order',
      'cross_event_alias_name',
      'cross_event_shared_alias',
    ]);
    expect([...draftsByRule.values()].every((count) => count > 0)).toBe(true);
  });

  it('atomically replaces the previous snapshot and retains it after a failed attempt', async () => {
    const repository = new PostgresDataCheckRepository(pool!);
    const firstSnapshot = 'a1000000-0000-4000-8000-000000000010';
    const secondSnapshot = 'a1000000-0000-4000-8000-000000000011';
    const result = (id: string, issueType: DataCheckIssueType): DataCheckScanResult => ({
      snapshotId: id,
      checkedAt: new Date('2026-07-23T10:00:00.000Z'),
      orphanCounts: { events: 1, relations: 2, cases: 3 },
      issues: [
        {
          severity: 'error',
          issueType,
          targetType: 'event',
          targetId: '11000000-0000-4000-8000-000000000003',
          relatedId: null,
          description: '测试快照问题',
          suggestion: '手动处理',
          actionMode: 'manual',
        },
      ],
      timings: [],
      semantic: { status: 'skipped', reason: 'not_recorded', issueCount: 0 },
    });

    await repository.replaceSnapshot(result(firstSnapshot, 'invalid_event_name'));
    await repository.replaceSnapshot(result(secondSnapshot, 'invalid_event_description'));
    const replaced = await repository.listIssues({ page: 1 });
    expect(replaced.items.map((item) => item.issueType)).toEqual(['invalid_event_description']);
    expect(replaced.items[0]?.snapshotId).toBe(secondSnapshot);

    const failed = await repository.markFailure('规则执行失败');
    expect(failed.task.status).toBe('failed');
    expect(failed.snapshot?.snapshotId).toBe(secondSnapshot);
    expect(failed.latestFailure?.message).toBe('规则执行失败');
    expect((await repository.listIssues({ page: 1 })).items).toEqual(replaced.items);
  });

  it('returns readable sources for every source layout without exposing ids as labels', async () => {
    const currentSnapshot = 'a1000000-0000-4000-8000-000000000019';
    const causeId = '12000000-0000-4000-8000-000000000001';
    const effectId = '12000000-0000-4000-8000-000000000002';
    const firstCaseId = '32000000-0000-4000-8000-000000000001';
    const secondCaseId = '32000000-0000-4000-8000-000000000002';
    const relationId = '22000000-0000-4000-8000-000000000001';
    const aliasId = '42000000-0000-4000-8000-000000000001';
    await pool!.query(
      `insert into abstract_events (id, name)
       values ($1, '供应中断'), ($2, '物流周期延长')`,
      [causeId, effectId],
    );
    await pool!.query(
      `insert into concrete_cases (id, content)
       values ($1, '港口拥堵造成交付延迟'), ($2, '航线调整造成运输周期增加')`,
      [firstCaseId, secondCaseId],
    );
    await pool!.query(
      `insert into causal_relations (id, cause_event_id, effect_event_id, confidence)
       values ($1, $2, $3, 60)`,
      [relationId, causeId, effectId],
    );
    await pool!.query(
      `insert into event_aliases (id, event_id, alias)
       values ($1, $2, '供应受阻')`,
      [aliasId, causeId],
    );
    await pool!.query(`delete from data_check_issues`);
    await pool!.query(
      `insert into data_check_issues (
         snapshot_id, severity, issue_type, description, suggestion,
         action_mode, target_type, target_id, related_id
       ) values
         ($1, 'warning', 'duplicate_event_name', '事件重复', '选择保留事件',
          'manual', 'event', $2, $3),
         ($1, 'warning', 'duplicate_case_content', '案例重复', '选择保留案例',
          'manual', 'case', $4, $5),
         ($1, 'error', 'relation_self_loop', '关系形成自环', '删除关系',
          'manual', 'relation', $6, null),
         ($1, 'error', 'invalid_alias_text', '别名无效', '编辑所属事件',
          'manual', 'alias', $7, $2),
         ($1, 'error', 'delete_missing_relation_case', '关联失效', '清理关联',
          'auto', 'relation_case', '22000000-0000-4000-8000-000000000099',
          '32000000-0000-4000-8000-000000000099')`,
      [currentSnapshot, causeId, effectId, firstCaseId, secondCaseId, relationId, aliasId],
    );
    await setCurrentSnapshot(currentSnapshot, { errors: 3, warnings: 2, open: 5 });

    const response = await app!.inject({
      method: 'GET',
      url: '/api/data-checks/latest/issues?page=1',
    });
    expect(response.statusCode).toBe(200);
    const result = response.json<DataCheckIssueListResponse>();
    const byType = new Map(result.items.map((item) => [item.issueType, item.source]));

    expect(byType.get('duplicate_event_name')).toMatchObject({
      displayKind: 'pair',
      items: [
        { label: '供应中断', detailPath: `/events/${causeId}` },
        { label: '物流周期延长', detailPath: `/events/${effectId}` },
      ],
    });
    expect(byType.get('duplicate_case_content')).toMatchObject({
      displayKind: 'pair',
      items: [
        { label: '港口拥堵造成交付延迟', detailPath: `/cases/${firstCaseId}` },
        { label: '航线调整造成运输周期增加', detailPath: `/cases/${secondCaseId}` },
      ],
    });
    expect(byType.get('relation_self_loop')).toMatchObject({
      displayKind: 'relation',
      relationDetailPaths: [`/relations/${relationId}`],
    });
    expect(byType.get('invalid_alias_text')).toMatchObject({
      displayKind: 'owned_value',
      items: [
        { label: '供应中断', detailPath: `/events/${causeId}` },
        { label: '供应受阻', detailPath: null },
      ],
    });
    expect(byType.get('delete_missing_relation_case')).toMatchObject({
      displayKind: 'broken_reference',
      items: [{ type: 'missing', detailPath: null }],
    });
    expect(
      result.items.flatMap((item) => item.source.items).map((item) => item.label),
    ).not.toContain('22000000-0000-4000-8000-000000000099');
  });

  it('filters and clamps fixed 50-row issue pages from the current snapshot', async () => {
    const currentSnapshot = 'a1000000-0000-4000-8000-000000000020';
    await pool!.query(`delete from data_check_issues`);
    await pool!.query(
      `insert into data_check_issues (
         snapshot_id, severity, issue_type, description, suggestion,
         action_mode, status, target_type, target_id, handled_at
       )
       select $1,
              case when number <= 51 then 'error' else 'warning' end,
              case
                when number % 2 = 0 then 'invalid_event_name'
                else 'invalid_event_description'
              end,
              '分页测试问题',
              '手动处理',
              'manual',
              case when number = 52 then 'handled' else 'open' end,
              'event',
              number::text,
              case when number = 52 then now() else null end
       from generate_series(1, 52) number`,
      [currentSnapshot],
    );
    await setCurrentSnapshot(currentSnapshot, { errors: 51, warnings: 1, open: 51, handled: 1 });

    const first = (
      await app!.inject({ method: 'GET', url: '/api/data-checks/latest/issues?page=1' })
    ).json<DataCheckIssueListResponse>();
    const second = (
      await app!.inject({ method: 'GET', url: '/api/data-checks/latest/issues?page=2' })
    ).json<DataCheckIssueListResponse>();
    const warning = (
      await app!.inject({
        method: 'GET',
        url: '/api/data-checks/latest/issues?page=99&severity=warning&status=handled',
      })
    ).json<DataCheckIssueListResponse>();

    expect(first).toMatchObject({ page: 1, pageSize: 50, totalItems: 52, totalPages: 2 });
    expect(first.items).toHaveLength(50);
    expect(second).toMatchObject({ page: 2, totalItems: 52, totalPages: 2 });
    expect(second.items).toHaveLength(2);
    expect(warning).toMatchObject({ page: 1, totalItems: 1, totalPages: 1 });
    expect(warning.items[0]).toMatchObject({ severity: 'warning', status: 'handled' });

    const byType = (
      await app!.inject({
        method: 'GET',
        url: '/api/data-checks/latest/issues?page=1&issueType=invalid_event_name',
      })
    ).json<DataCheckIssueListResponse>();
    expect(byType.totalItems).toBe(26);
  });

  it('marks an interrupted persisted run as failed when a new API instance becomes ready', async () => {
    await pool!.query(
      `update data_check_state
       set status = 'running',
           attempt_started_at = now(),
           attempt_finished_at = null
       where singleton_key = true`,
    );
    const restarted = buildApp({
      logger: false,
      checkDatabase: async () => true,
      databasePool: pool!,
    });
    await restarted.ready();
    const latest = (
      await restarted.inject({ method: 'GET', url: '/api/data-checks/latest' })
    ).json<DataCheckLatestResponse>();
    await restarted.close();

    expect(latest.task.status).toBe('failed');
    expect(latest.latestFailure?.message).toContain('API 进程中断');
  });
});
