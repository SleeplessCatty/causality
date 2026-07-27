import type {
  DataCheckIssue,
  DataCheckIssueListQuery,
  DataCheckIssueListResponse,
  DataCheckIssueType,
  DataCheckLatestResponse,
  DataCheckSemanticReason,
  DataCheckSemanticStatus,
} from '@causality/contracts';
import type { Pool, PoolClient } from 'pg';

import type {
  DataCheckActionMode,
  DataCheckIssueDraft,
  DataCheckRepository,
  DataCheckScanResult,
  DataCheckStartResult,
} from './dataCheckTypes.js';
import { loadDataCheckIssueSources } from './dataCheckIssueSource.js';

const dataCheckLockKey = 2_026_072_301;
const issuePageSize = 50;

export type DataCheckRepositoryErrorCode =
  | 'DATA_CHECK_ISSUE_NOT_FOUND'
  | 'DATA_CHECK_ISSUE_STALE'
  | 'DATA_CHECK_AUTO_HANDLE_UNSAFE'
  | 'DATA_CHECK_ACTION_NOT_ALLOWED'
  | 'DATA_CHECK_ACTION_CONFLICT';

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
  semantic_status: DataCheckSemanticStatus | null;
  semantic_reason: DataCheckSemanticReason;
}

export interface DataCheckIssueRow {
  id: string;
  snapshot_id: string;
  severity: DataCheckIssue['severity'];
  issue_type: DataCheckIssueType;
  description: string;
  suggestion: string;
  action_mode: DataCheckActionMode;
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
       handled_count,
       semantic_status,
       semantic_reason
from data_check_state
where singleton_key = true
`;

export const dataCheckIssueSelect = `
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
  if (row.last_snapshot_id && row.last_success_at && !row.semantic_status) {
    throw new Error('Missing semantic status for latest data-check snapshot');
  }
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
          semanticStatus: row.semantic_status!,
          semanticReason: row.semantic_reason,
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

export function mapDataCheckIssue(row: DataCheckIssueRow): DataCheckIssue {
  return {
    id: row.id,
    snapshotId: row.snapshot_id,
    severity: row.severity,
    issueType: row.issue_type,
    description: row.description,
    suggestion: row.suggestion,
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

export async function readCurrentIssueForUpdate(
  client: PoolClient,
  issueId: string,
  snapshotId: string,
): Promise<DataCheckIssueRow> {
  const state = await client.query<{ last_snapshot_id: string | null }>(
    `select last_snapshot_id
     from data_check_state
     where singleton_key = true
     for update`,
  );
  if (state.rows[0]?.last_snapshot_id !== snapshotId) {
    throw new DataCheckRepositoryError('DATA_CHECK_ISSUE_STALE', '该问题不属于最近一次检查结果');
  }

  const issue = await client.query<DataCheckIssueRow>(
    `${dataCheckIssueSelect}
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

export async function readCurrentIssue(
  client: PoolClient,
  issueId: string,
  snapshotId: string,
): Promise<DataCheckIssueRow> {
  const state = await client.query<{ last_snapshot_id: string | null }>(
    `select last_snapshot_id
     from data_check_state
     where singleton_key = true`,
  );
  if (state.rows[0]?.last_snapshot_id !== snapshotId) {
    throw new DataCheckRepositoryError('DATA_CHECK_ISSUE_STALE', '该问题不属于最近一次检查结果');
  }

  const issue = await client.query<DataCheckIssueRow>(
    `${dataCheckIssueSelect}
     where id = $1 and snapshot_id = $2`,
    [issueId, snapshotId],
  );
  const row = issue.rows[0];
  if (!row) {
    throw new DataCheckRepositoryError('DATA_CHECK_ISSUE_NOT_FOUND', '检查问题不存在');
  }
  return row;
}

export async function markIssueHandled(
  client: PoolClient,
  row: DataCheckIssueRow,
): Promise<DataCheckIssue> {
  if (row.status === 'handled') return mapDataCheckIssue(row);

  const updated = await client.query<DataCheckIssueRow>(
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
  return mapDataCheckIssue(updated.rows[0]!);
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
             handled_count = 0,
             semantic_status = $9,
             semantic_reason = $10
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
          result.semantic.status,
          result.semantic.reason,
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
      const issues = await client.query<DataCheckIssueRow>(
        `${dataCheckIssueSelect}
         where ${filter}
         order by case severity when 'error' then 0 else 1 end,
                  issue_type,
                  id
         limit ${issuePageSize}
         offset $5`,
        [...parameters, (page - 1) * issuePageSize],
      );
      const sources = await loadDataCheckIssueSources(
        client,
        issues.rows.map((row) => ({
          id: row.id,
          issueType: row.issue_type,
          targetType: row.target_type,
          targetId: row.target_id,
          relatedId: row.related_id,
        })),
      );
      await client.query('commit');
      return {
        items: issues.rows.map((row) => {
          const source = sources.get(row.id);
          if (!source) {
            throw new Error(`Missing data-check issue source for issue ${row.id}`);
          }
          return { ...mapDataCheckIssue(row), source };
        }),
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
}
