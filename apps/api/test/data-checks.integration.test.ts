import type {
  DataCheckIssue,
  DataCheckIssueListResponse,
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

    const latest = await waitForFinished();
    expect(latest).toMatchObject({
      task: { status: 'succeeded' },
      snapshot: {
        orphanEventCount: 0,
        orphanRelationCount: 1,
        orphanCaseCount: 1,
        errorCount: 0,
        warningCount: 0,
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
    const result = (id: string, issueType: string): DataCheckScanResult => ({
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
    });

    await repository.replaceSnapshot(result(firstSnapshot, 'first_snapshot_issue'));
    await repository.replaceSnapshot(result(secondSnapshot, 'second_snapshot_issue'));
    const replaced = await repository.listIssues({ page: 1 });
    expect(replaced.items.map((item) => item.issueType)).toEqual(['second_snapshot_issue']);
    expect(replaced.items[0]?.snapshotId).toBe(secondSnapshot);

    const failed = await repository.markFailure('规则执行失败');
    expect(failed.task.status).toBe('failed');
    expect(failed.snapshot?.snapshotId).toBe(secondSnapshot);
    expect(failed.latestFailure?.message).toBe('规则执行失败');
    expect((await repository.listIssues({ page: 1 })).items).toEqual(replaced.items);
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
              case when number % 2 = 0 then 'even_issue' else 'odd_issue' end,
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
        url: '/api/data-checks/latest/issues?page=1&issueType=even_issue',
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

  it('handles a current manual issue idempotently and rejects stale or unknown issues', async () => {
    const currentSnapshot = 'a1000000-0000-4000-8000-000000000030';
    const currentIssue = 'b1000000-0000-4000-8000-000000000030';
    await pool!.query(`delete from data_check_issues`);
    await pool!.query(
      `insert into data_check_issues (
         id, snapshot_id, severity, issue_type, description, suggestion,
         action_mode, target_type, target_id
       ) values ($1, $2, 'error', 'relation_self_loop', '测试手动问题', '手动处理',
                 'manual', 'relation', '21000000-0000-4000-8000-000000000001')`,
      [currentIssue, currentSnapshot],
    );
    await setCurrentSnapshot(currentSnapshot, { errors: 1, warnings: 0, open: 1 });

    const url = `/api/data-checks/issues/${currentIssue}/manual-handle`;
    const first = await app!.inject({
      method: 'POST',
      url,
      payload: { snapshotId: currentSnapshot },
    });
    const second = await app!.inject({
      method: 'POST',
      url,
      payload: { snapshotId: currentSnapshot },
    });
    expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
    expect(first.json<DataCheckIssue>()).toMatchObject({ status: 'handled' });
    expect(second.json<DataCheckIssue>()).toEqual(first.json());

    const summary = await app!.inject({ method: 'GET', url: '/api/data-checks/latest' });
    expect(summary.json<DataCheckLatestResponse>().snapshot).toMatchObject({
      openCount: 0,
      handledCount: 1,
    });

    const stale = await app!.inject({
      method: 'POST',
      url,
      payload: { snapshotId: 'a1000000-0000-4000-8000-000000000099' },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: 'DATA_CHECK_ISSUE_STALE' });

    const unknown = await app!.inject({
      method: 'POST',
      url: '/api/data-checks/issues/b1000000-0000-4000-8000-000000000099/manual-handle',
      payload: { snapshotId: currentSnapshot },
    });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toMatchObject({ code: 'DATA_CHECK_ISSUE_NOT_FOUND' });
  });

  it('auto-deletes a still-invalid child and refuses a no-longer-safe action', async () => {
    const currentSnapshot = 'a1000000-0000-4000-8000-000000000040';
    const missingAliasId = '41000000-0000-4000-8000-000000000040';
    const validAliasId = '41000000-0000-4000-8000-000000000041';
    const missingIssueId = 'b1000000-0000-4000-8000-000000000040';
    const unsafeIssueId = 'b1000000-0000-4000-8000-000000000041';
    const validEventId = '10000000-0000-4000-8000-000000000001';

    const client = await pool!.connect();
    try {
      await client.query('begin');
      await client.query('set session_replication_role = replica');
      await client.query(
        `insert into event_aliases (id, event_id, alias)
         values ($1, '11000000-0000-4000-8000-000000000099', '失效自动处理别名')`,
        [missingAliasId],
      );
      await client.query('set session_replication_role = origin');
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
    await pool!.query(
      `insert into event_aliases (id, event_id, alias)
       values ($1, $2, '当前有效别名')`,
      [validAliasId, validEventId],
    );
    await pool!.query(`delete from data_check_issues`);
    await pool!.query(
      `insert into data_check_issues (
         id, snapshot_id, severity, issue_type, description, suggestion,
         action_mode, target_type, target_id, related_id
       ) values
         ($1, $3, 'error', 'delete_missing_alias', '失效别名', '删除失效别名',
          'auto', 'alias', $4, '11000000-0000-4000-8000-000000000099'),
         ($2, $3, 'error', 'delete_missing_alias', '失效别名', '删除失效别名',
          'auto', 'alias', $5, $6)`,
      [missingIssueId, unsafeIssueId, currentSnapshot, missingAliasId, validAliasId, validEventId],
    );
    await setCurrentSnapshot(currentSnapshot, { errors: 2, warnings: 0, open: 2 });

    const handled = await app!.inject({
      method: 'POST',
      url: `/api/data-checks/issues/${missingIssueId}/auto-handle`,
      payload: { snapshotId: currentSnapshot },
    });
    expect(handled.statusCode).toBe(200);
    expect(handled.json<DataCheckIssue>().status).toBe('handled');
    expect(
      (
        await pool!.query<{ count: number }>(
          `select count(*)::int as count from event_aliases where id = $1`,
          [missingAliasId],
        )
      ).rows[0]?.count,
    ).toBe(0);

    const unsafe = await app!.inject({
      method: 'POST',
      url: `/api/data-checks/issues/${unsafeIssueId}/auto-handle`,
      payload: { snapshotId: currentSnapshot },
    });
    expect(unsafe.statusCode).toBe(409);
    expect(unsafe.json()).toMatchObject({ code: 'DATA_CHECK_AUTO_HANDLE_UNSAFE' });
    expect(
      (
        await pool!.query<{ count: number }>(
          `select count(*)::int as count from event_aliases where id = $1`,
          [validAliasId],
        )
      ).rows[0]?.count,
    ).toBe(1);
  });

  it('executes every remaining safe automatic action and accepts vanished targets', async () => {
    const currentSnapshot = 'a1000000-0000-4000-8000-000000000050';
    const eventId = '12000000-0000-4000-8000-000000000050';
    const resequenceEventId = '12000000-0000-4000-8000-000000000051';
    const caseId = '32000000-0000-4000-8000-000000000050';
    const missingKeywordId = '52000000-0000-4000-8000-000000000050';
    const missingRelationId = '22000000-0000-4000-8000-000000000050';
    const duplicateAliasId = '42000000-0000-4000-8000-000000000051';
    const duplicateKeywordId = '52000000-0000-4000-8000-000000000052';
    const vanishedAliasId = '42000000-0000-4000-8000-000000000099';
    const issueIds = [
      'b2000000-0000-4000-8000-000000000050',
      'b2000000-0000-4000-8000-000000000051',
      'b2000000-0000-4000-8000-000000000052',
      'b2000000-0000-4000-8000-000000000053',
      'b2000000-0000-4000-8000-000000000054',
      'b2000000-0000-4000-8000-000000000055',
    ];
    await pool!.query(
      `insert into abstract_events (id, name)
       values ($1, '自动处理重复从属记录'), ($2, '自动整理关键词位置')`,
      [eventId, resequenceEventId],
    );
    await pool!.query(`insert into concrete_cases (id, content) values ($1, '自动处理关联案例')`, [
      caseId,
    ]);

    const client = await pool!.connect();
    try {
      await client.query('begin');
      await client.query('set session_replication_role = replica');
      await client.query(
        `insert into event_keywords (id, event_id, keyword, position)
         values ($1, '12000000-0000-4000-8000-000000000099', '失效关键词', 1)`,
        [missingKeywordId],
      );
      await client.query(
        `insert into causal_relation_cases (causal_relation_id, concrete_case_id)
         values ($1, $2)`,
        [missingRelationId, caseId],
      );
      await client.query('set session_replication_role = origin');
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }

    await pool!.query(`drop index event_aliases_event_normalized_uidx`);
    await pool!.query(`drop index event_keywords_event_normalized_uidx`);
    await pool!.query(
      `insert into event_aliases (id, event_id, alias, created_at) values
         ('42000000-0000-4000-8000-000000000050', $1, '重复自动别名', now() - interval '1 second'),
         ($2, $1, '重复自动别名', now())`,
      [eventId, duplicateAliasId],
    );
    await pool!.query(
      `insert into event_keywords (id, event_id, keyword, position) values
         ('52000000-0000-4000-8000-000000000051', $1, '重复自动关键词', 1),
         ($2, $1, '重复自动关键词', 2),
         ('52000000-0000-4000-8000-000000000055', $1, '保留的其他关键词', 3),
         ('52000000-0000-4000-8000-000000000053', $3, '位置一', 1),
         ('52000000-0000-4000-8000-000000000054', $3, '位置三', 3)`,
      [eventId, duplicateKeywordId, resequenceEventId],
    );

    await pool!.query(`delete from data_check_issues`);
    await pool!.query(
      `insert into data_check_issues (
         id, snapshot_id, severity, issue_type, description, suggestion,
         action_mode, target_type, target_id, related_id
       ) values
         ($1, $7, 'error', 'delete_missing_keyword', '失效关键词', '删除',
          'auto', 'keyword', $8, null),
         ($2, $7, 'error', 'delete_missing_relation_case', '失效关联', '删除',
          'auto', 'relation_case', $9, $10),
         ($3, $7, 'error', 'delete_duplicate_alias', '重复别名', '删除',
          'auto', 'alias', $11, null),
         ($4, $7, 'error', 'delete_duplicate_keyword', '重复关键词', '删除',
          'auto', 'keyword', $12, null),
         ($5, $7, 'error', 'resequence_keywords', '关键词位置异常', '重排',
          'auto', 'event', $13, null),
         ($6, $7, 'error', 'delete_missing_alias', '目标已不存在', '删除',
          'auto', 'alias', $14, null)`,
      [
        ...issueIds,
        currentSnapshot,
        missingKeywordId,
        missingRelationId,
        caseId,
        duplicateAliasId,
        duplicateKeywordId,
        resequenceEventId,
        vanishedAliasId,
      ],
    );
    await setCurrentSnapshot(currentSnapshot, { errors: 6, warnings: 0, open: 6 });

    for (const currentIssueId of issueIds) {
      const response = await app!.inject({
        method: 'POST',
        url: `/api/data-checks/issues/${currentIssueId}/auto-handle`,
        payload: { snapshotId: currentSnapshot },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<DataCheckIssue>().status).toBe('handled');
    }

    const deletedChildren = await pool!.query<{ count: number }>(
      `select (
         (select count(*) from event_keywords where id in ($1, $2))
         + (select count(*) from event_aliases where id = $3)
         + (select count(*) from causal_relation_cases
            where causal_relation_id = $4 and concrete_case_id = $5)
       )::int as count`,
      [missingKeywordId, duplicateKeywordId, duplicateAliasId, missingRelationId, caseId],
    );
    expect(deletedChildren.rows[0]?.count).toBe(0);
    const positions = await pool!.query<{ position: number }>(
      `select position from event_keywords where event_id = $1 order by position`,
      [resequenceEventId],
    );
    expect(positions.rows.map((row) => Number(row.position))).toEqual([1, 2]);
    const duplicateEventPositions = await pool!.query<{ position: number }>(
      `select position from event_keywords where event_id = $1 order by position`,
      [eventId],
    );
    expect(duplicateEventPositions.rows.map((row) => Number(row.position))).toEqual([1, 2]);
    expect(
      (await app!.inject({ method: 'GET', url: '/api/data-checks/latest' })).json(),
    ).toMatchObject({
      snapshot: { openCount: 0, handledCount: 6 },
    });
  });
});
