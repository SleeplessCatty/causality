import type {
  DataCheckIssue,
  DataCheckIssueListQuery,
  DataCheckIssueListResponse,
  DataCheckLatestResponse,
} from '@causality/contracts';
import type { Pool, PoolClient } from 'pg';

import type {
  DataCheckIssueDraft,
  DataCheckRepository,
  DataCheckScanResult,
  DataCheckStartResult,
} from './dataCheckTypes.js';

const dataCheckLockKey = 2_026_072_301;
const issuePageSize = 50;

export type DataCheckRepositoryErrorCode =
  'DATA_CHECK_ISSUE_NOT_FOUND' | 'DATA_CHECK_ISSUE_STALE' | 'DATA_CHECK_AUTO_HANDLE_UNSAFE';

export class DataCheckRepositoryError extends Error {
  public constructor(
    public readonly code: DataCheckRepositoryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DataCheckRepositoryError';
  }
}

interface StateRow {
  status: DataCheckLatestResponse['task']['status'];
  attempt_started_at: Date | null;
  attempt_finished_at: Date | null;
  last_failure_at: Date | null;
  last_failure_message: string | null;
  last_snapshot_id: string | null;
  last_success_at: Date | null;
  orphan_event_count: number;
  orphan_relation_count: number;
  orphan_case_count: number;
  error_count: number;
  warning_count: number;
  open_count: number;
  handled_count: number;
}

interface IssueRow {
  id: string;
  snapshot_id: string;
  severity: DataCheckIssue['severity'];
  issue_type: string;
  description: string;
  suggestion: string;
  action_mode: DataCheckIssue['actionMode'];
  status: DataCheckIssue['status'];
  target_type: DataCheckIssue['targetType'];
  target_id: string;
  related_id: string | null;
  handled_at: Date | null;
}

const stateSelect = `
select status,
       attempt_started_at,
       attempt_finished_at,
       last_failure_at,
       last_failure_message,
       last_snapshot_id,
       last_success_at,
       orphan_event_count,
       orphan_relation_count,
       orphan_case_count,
       error_count,
       warning_count,
       open_count,
       handled_count
from data_check_state
where singleton_key = true
`;

const issueSelect = `
select id,
       snapshot_id,
       severity,
       issue_type,
       description,
       suggestion,
       action_mode,
       status,
       target_type,
       target_id,
       related_id,
       handled_at
from data_check_issues
`;

function toIso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function mapLatest(row: StateRow): DataCheckLatestResponse {
  const snapshot =
    row.last_snapshot_id && row.last_success_at
      ? {
          snapshotId: row.last_snapshot_id,
          checkedAt: row.last_success_at.toISOString(),
          orphanEventCount: Number(row.orphan_event_count),
          orphanRelationCount: Number(row.orphan_relation_count),
          orphanCaseCount: Number(row.orphan_case_count),
          errorCount: Number(row.error_count),
          warningCount: Number(row.warning_count),
          openCount: Number(row.open_count),
          handledCount: Number(row.handled_count),
        }
      : null;
  const latestFailure =
    row.last_failure_at && row.last_failure_message
      ? {
          failedAt: row.last_failure_at.toISOString(),
          message: row.last_failure_message,
        }
      : null;

  return {
    task: {
      status: row.status,
      startedAt: toIso(row.attempt_started_at),
      finishedAt: toIso(row.attempt_finished_at),
    },
    snapshot,
    latestFailure,
  };
}

function mapIssue(row: IssueRow): DataCheckIssue {
  return {
    id: row.id,
    snapshotId: row.snapshot_id,
    severity: row.severity,
    issueType: row.issue_type,
    description: row.description,
    suggestion: row.suggestion,
    actionMode: row.action_mode,
    status: row.status,
    targetType: row.target_type,
    targetId: row.target_id,
    relatedId: row.related_id,
    handledAt: toIso(row.handled_at),
  };
}

async function readLatest(client: PoolClient): Promise<DataCheckLatestResponse> {
  const result = await client.query<StateRow>(stateSelect);
  const row = result.rows[0];
  if (!row) throw new Error('Missing data_check_state singleton');
  return mapLatest(row);
}

async function insertIssues(
  client: PoolClient,
  snapshotId: string,
  issues: readonly DataCheckIssueDraft[],
): Promise<void> {
  if (issues.length === 0) return;
  await client.query(
    `insert into data_check_issues (
       snapshot_id,
       severity,
       issue_type,
       description,
       suggestion,
       action_mode,
       target_type,
       target_id,
       related_id
     )
     select $1::uuid,
            issue.severity,
            issue.issue_type,
            issue.description,
            issue.suggestion,
            issue.action_mode,
            issue.target_type,
            issue.target_id,
            issue.related_id
     from unnest(
       $2::text[],
       $3::text[],
       $4::text[],
       $5::text[],
       $6::text[],
       $7::text[],
       $8::text[],
       $9::text[]
     ) as issue(
       severity,
       issue_type,
       description,
       suggestion,
       action_mode,
       target_type,
       target_id,
       related_id
     )`,
    [
      snapshotId,
      issues.map((issue) => issue.severity),
      issues.map((issue) => issue.issueType),
      issues.map((issue) => issue.description),
      issues.map((issue) => issue.suggestion),
      issues.map((issue) => issue.actionMode),
      issues.map((issue) => issue.targetType),
      issues.map((issue) => issue.targetId),
      issues.map((issue) => issue.relatedId),
    ],
  );
}

async function readCurrentIssueForUpdate(
  client: PoolClient,
  issueId: string,
  snapshotId: string,
): Promise<IssueRow> {
  const state = await client.query<{ last_snapshot_id: string | null }>(
    `select last_snapshot_id
     from data_check_state
     where singleton_key = true
     for update`,
  );
  if (state.rows[0]?.last_snapshot_id !== snapshotId) {
    throw new DataCheckRepositoryError('DATA_CHECK_ISSUE_STALE', '该问题不属于最近一次检查结果');
  }

  const issue = await client.query<IssueRow>(
    `${issueSelect}
     where id = $1 and snapshot_id = $2
     for update`,
    [issueId, snapshotId],
  );
  const row = issue.rows[0];
  if (!row) {
    throw new DataCheckRepositoryError('DATA_CHECK_ISSUE_NOT_FOUND', '检查问题不存在');
  }
  return row;
}

async function markIssueHandled(client: PoolClient, row: IssueRow): Promise<DataCheckIssue> {
  if (row.status === 'handled') return mapIssue(row);

  const updated = await client.query<IssueRow>(
    `update data_check_issues
     set status = 'handled', handled_at = clock_timestamp()
     where id = $1
     returning id,
               snapshot_id,
               severity,
               issue_type,
               description,
               suggestion,
               action_mode,
               status,
               target_type,
               target_id,
               related_id,
               handled_at`,
    [row.id],
  );
  await client.query(
    `update data_check_state
     set open_count = greatest(open_count - 1, 0),
         handled_count = handled_count + 1
     where singleton_key = true`,
  );
  return mapIssue(updated.rows[0]!);
}

async function deleteMissingAlias(client: PoolClient, targetId: string): Promise<boolean> {
  const result = await client.query<{ id: string; reference_missing: boolean }>(
    `select alias.id, (event.id is null) as reference_missing
     from event_aliases alias
     left join abstract_events event on event.id = alias.event_id
     where alias.id = $1
     for update of alias`,
    [targetId],
  );
  const row = result.rows[0];
  if (!row) return true;
  if (!row.reference_missing) return false;
  await client.query(`delete from event_aliases where id = $1`, [targetId]);
  return true;
}

async function deleteMissingKeyword(client: PoolClient, targetId: string): Promise<boolean> {
  const result = await client.query<{ id: string; reference_missing: boolean }>(
    `select keyword.id, (event.id is null) as reference_missing
     from event_keywords keyword
     left join abstract_events event on event.id = keyword.event_id
     where keyword.id = $1
     for update of keyword`,
    [targetId],
  );
  const row = result.rows[0];
  if (!row) return true;
  if (!row.reference_missing) return false;
  await client.query(`delete from event_keywords where id = $1`, [targetId]);
  return true;
}

async function deleteMissingRelationCase(
  client: PoolClient,
  relationId: string,
  caseId: string | null,
): Promise<boolean> {
  if (!caseId) return false;
  const result = await client.query<{
    causal_relation_id: string;
    concrete_case_id: string;
    reference_missing: boolean;
  }>(
    `select relation_case.causal_relation_id,
            relation_case.concrete_case_id,
            (relation.id is null or concrete_case.id is null) as reference_missing
     from causal_relation_cases relation_case
     left join causal_relations relation on relation.id = relation_case.causal_relation_id
     left join concrete_cases concrete_case on concrete_case.id = relation_case.concrete_case_id
     where relation_case.causal_relation_id = $1
       and relation_case.concrete_case_id = $2
     for update of relation_case`,
    [relationId, caseId],
  );
  const row = result.rows[0];
  if (!row) return true;
  if (!row.reference_missing) return false;
  await client.query(
    `delete from causal_relation_cases
     where causal_relation_id = $1 and concrete_case_id = $2`,
    [relationId, caseId],
  );
  return true;
}

async function deleteDuplicateAlias(client: PoolClient, targetId: string): Promise<boolean> {
  const result = await client.query<{ duplicate_exists: boolean }>(
    `select exists (
       select 1
       from event_aliases retained
       where retained.event_id = target.event_id
         and retained.normalized_alias = target.normalized_alias
         and (retained.created_at, retained.id) < (target.created_at, target.id)
     ) as duplicate_exists
     from event_aliases target
     where target.id = $1
     for update of target`,
    [targetId],
  );
  const row = result.rows[0];
  if (!row) return true;
  if (!row.duplicate_exists) return false;
  await client.query(`delete from event_aliases where id = $1`, [targetId]);
  return true;
}

async function deleteDuplicateKeyword(client: PoolClient, targetId: string): Promise<boolean> {
  const result = await client.query<{ event_id: string; duplicate_exists: boolean }>(
    `select target.event_id,
            exists (
       select 1
       from event_keywords retained
       where retained.event_id = target.event_id
         and retained.normalized_keyword = target.normalized_keyword
         and (retained.position, retained.id) < (target.position, target.id)
     ) as duplicate_exists
     from event_keywords target
     where target.id = $1
     for update of target`,
    [targetId],
  );
  const row = result.rows[0];
  if (!row) return true;
  if (!row.duplicate_exists) return false;
  await client.query(`delete from event_keywords where id = $1`, [targetId]);
  return resequenceKeywords(client, row.event_id);
}

interface KeywordRow {
  id: string;
  event_id: string;
  keyword: string;
  position: number;
}

async function resequenceKeywords(client: PoolClient, eventId: string): Promise<boolean> {
  const result = await client.query<KeywordRow>(
    `select id, event_id, keyword, position
     from event_keywords
     where event_id = $1
     order by position, id
     for update`,
    [eventId],
  );
  if (result.rows.length > 20) return false;
  const valid = result.rows.every((row, index) => Number(row.position) === index + 1);
  if (valid) return true;
  if (result.rows.length === 0) return true;

  await client.query(`delete from event_keywords where event_id = $1`, [eventId]);
  await client.query(
    `insert into event_keywords (id, event_id, keyword, position)
     select keyword.id, keyword.event_id, keyword.keyword, keyword.position
     from unnest($1::uuid[], $2::uuid[], $3::text[], $4::int[])
       as keyword(id, event_id, keyword, position)`,
    [
      result.rows.map((row) => row.id),
      result.rows.map((row) => row.event_id),
      result.rows.map((row) => row.keyword),
      result.rows.map((_row, index) => index + 1),
    ],
  );
  return true;
}

async function applyAutomaticAction(client: PoolClient, issue: IssueRow): Promise<boolean> {
  switch (issue.issue_type) {
    case 'delete_missing_alias':
      return deleteMissingAlias(client, issue.target_id);
    case 'delete_missing_keyword':
      return deleteMissingKeyword(client, issue.target_id);
    case 'delete_missing_relation_case':
      return deleteMissingRelationCase(client, issue.target_id, issue.related_id);
    case 'delete_duplicate_alias':
      return deleteDuplicateAlias(client, issue.target_id);
    case 'delete_duplicate_keyword':
      return deleteDuplicateKeyword(client, issue.target_id);
    case 'resequence_keywords':
      return resequenceKeywords(client, issue.target_id);
    default:
      return false;
  }
}

export class PostgresDataCheckRepository implements DataCheckRepository {
  public constructor(private readonly pool: Pool) {}

  public async tryStart(): Promise<DataCheckStartResult> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query(`select pg_advisory_xact_lock($1)`, [dataCheckLockKey]);

      const state = await client.query<{ status: string }>(
        `select status from data_check_state where singleton_key = true for update`,
      );
      if (state.rows[0]?.status === 'running') {
        const latest = await readLatest(client);
        await client.query('commit');
        return { started: false, latest };
      }

      await client.query(
        `update data_check_state
         set status = 'running',
             attempt_started_at = clock_timestamp(),
             attempt_finished_at = null
         where singleton_key = true`,
      );
      const latest = await readLatest(client);
      await client.query('commit');
      return { started: true, latest };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  public async latest(): Promise<DataCheckLatestResponse> {
    const client = await this.pool.connect();
    try {
      return await readLatest(client);
    } finally {
      client.release();
    }
  }

  public async replaceSnapshot(result: DataCheckScanResult): Promise<DataCheckLatestResponse> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `select singleton_key
         from data_check_state
         where singleton_key = true
         for update`,
      );
      await client.query(`delete from data_check_issues`);
      await insertIssues(client, result.snapshotId, result.issues);

      const errorCount = result.issues.filter((issue) => issue.severity === 'error').length;
      const warningCount = result.issues.length - errorCount;
      await client.query(
        `update data_check_state
         set status = 'succeeded',
             attempt_finished_at = clock_timestamp(),
             last_failure_at = null,
             last_failure_message = null,
             last_snapshot_id = $1,
             last_success_at = $2,
             orphan_event_count = $3,
             orphan_relation_count = $4,
             orphan_case_count = $5,
             error_count = $6,
             warning_count = $7,
             open_count = $8,
             handled_count = 0
         where singleton_key = true`,
        [
          result.snapshotId,
          result.checkedAt,
          result.orphanCounts.events,
          result.orphanCounts.relations,
          result.orphanCounts.cases,
          errorCount,
          warningCount,
          result.issues.length,
        ],
      );
      const latest = await readLatest(client);
      await client.query('commit');
      return latest;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  public async markFailure(message: string): Promise<DataCheckLatestResponse> {
    const client = await this.pool.connect();
    try {
      await client.query(
        `update data_check_state
         set status = 'failed',
             attempt_finished_at = clock_timestamp(),
             last_failure_at = clock_timestamp(),
             last_failure_message = $1
         where singleton_key = true`,
        [message.slice(0, 500) || '数据检查失败'],
      );
      return await readLatest(client);
    } finally {
      client.release();
    }
  }

  public async recoverInterrupted(): Promise<DataCheckLatestResponse> {
    const client = await this.pool.connect();
    try {
      await client.query(
        `update data_check_state
         set status = 'failed',
             attempt_finished_at = clock_timestamp(),
             last_failure_at = clock_timestamp(),
             last_failure_message = '上一次数据检查因 API 进程中断而停止'
         where singleton_key = true and status = 'running'`,
      );
      return await readLatest(client);
    } finally {
      client.release();
    }
  }

  public async listIssues(query: DataCheckIssueListQuery): Promise<DataCheckIssueListResponse> {
    const client = await this.pool.connect();
    try {
      await client.query('begin transaction isolation level repeatable read read only');
      const latest = await readLatest(client);
      const snapshotId = latest.snapshot?.snapshotId;
      if (!snapshotId) {
        await client.query('commit');
        return { items: [], page: 1, pageSize: issuePageSize, totalItems: 0, totalPages: 1 };
      }

      const parameters = [
        snapshotId,
        query.severity ?? null,
        query.issueType ?? null,
        query.status ?? null,
      ];
      const filter = `
        snapshot_id = $1
        and ($2::text is null or severity = $2)
        and ($3::text is null or issue_type = $3)
        and ($4::text is null or status = $4)
      `;
      const count = await client.query<{ total: number }>(
        `select count(*)::int as total
         from data_check_issues
         where ${filter}`,
        parameters,
      );
      const totalItems = Number(count.rows[0]?.total ?? 0);
      const totalPages = Math.max(1, Math.ceil(totalItems / issuePageSize));
      const page = Math.min(query.page, totalPages);
      const issues = await client.query<IssueRow>(
        `${issueSelect}
         where ${filter}
         order by case severity when 'error' then 0 else 1 end,
                  issue_type,
                  id
         limit ${issuePageSize}
         offset $5`,
        [...parameters, (page - 1) * issuePageSize],
      );
      await client.query('commit');
      return {
        items: issues.rows.map(mapIssue),
        page,
        pageSize: issuePageSize,
        totalItems,
        totalPages,
      };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  public async manualHandle(issueId: string, snapshotId: string): Promise<DataCheckIssue> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const issue = await readCurrentIssueForUpdate(client, issueId, snapshotId);
      const handled = await markIssueHandled(client, issue);
      await client.query('commit');
      return handled;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  public async autoHandle(issueId: string, snapshotId: string): Promise<DataCheckIssue> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const issue = await readCurrentIssueForUpdate(client, issueId, snapshotId);
      if (issue.status === 'handled') {
        await client.query('commit');
        return mapIssue(issue);
      }
      if (issue.action_mode !== 'auto' || !(await applyAutomaticAction(client, issue))) {
        throw new DataCheckRepositoryError(
          'DATA_CHECK_AUTO_HANDLE_UNSAFE',
          '数据已变化，无法安全自动处理该问题',
        );
      }
      const handled = await markIssueHandled(client, issue);
      await client.query('commit');
      return handled;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
}
