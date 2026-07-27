import { useQuery } from '@tanstack/react-query';

import type { DataCheckIssue, DataCheckIssueListQuery } from '@causality/contracts';
import { AppSelect } from '../../shared/controls/AppSelect';
import { listRecordDomId, useListRecordFocus } from '../../shared/navigation/useListRecordFocus';
import { ListPagination } from '../../shared/pagination/ListPagination';
import { getDataCheckIssues } from './dataMaintenanceApi';
import { dataCheckIssueTypeOptions, type DataCheckQueryState } from './useDataCheckQueryState';

interface DataCheckIssueTableProps {
  snapshotId: string | null;
  queryState: DataCheckQueryState;
}

const severityOptions = [
  { value: '' as const, label: '全部' },
  { value: 'error' as const, label: '错误' },
  { value: 'warning' as const, label: '警告' },
];

const statusOptions = [
  { value: '' as const, label: '全部' },
  { value: 'open' as const, label: '未处理' },
  { value: 'handled' as const, label: '已处理' },
];

const issueFilterOptions = [
  { value: '', label: '全部' },
  ...dataCheckIssueTypeOptions.map(([value, label]) => ({ value, label })),
];

function IssueDescription({ issue }: { issue: DataCheckIssue }) {
  return (
    <div className="data-check-issue__description">
      <span
        className={`data-check-severity data-check-severity--${issue.severity}`}
        aria-label={issue.severity === 'error' ? '错误' : '警告'}
      >
        {issue.severity === 'error' ? '错误' : '警告'}
      </span>
      <span>{issue.description}</span>
      <div className="data-check-issue__references">
        <code>{issue.targetId}</code>
        {issue.relatedId ? <code>{issue.relatedId}</code> : null}
      </div>
    </div>
  );
}

export function DataCheckIssueTable({ snapshotId, queryState }: DataCheckIssueTableProps) {
  const { page, severity, issueType, status, issueId } = queryState;
  const queryKey = [
    'data-checks',
    'issues',
    { snapshotId, page, severity, issueType, status },
  ] as const;
  const issues = useQuery({
    queryKey,
    enabled: snapshotId !== null,
    queryFn: ({ signal }) => {
      const query: DataCheckIssueListQuery = {
        page,
        ...(severity ? { severity } : {}),
        ...(issueType ? { issueType } : {}),
        ...(status ? { status } : {}),
      };
      return getDataCheckIssues(query, signal);
    },
  });
  const data = issues.data;
  useListRecordFocus(data?.items.map((current) => current.id) ?? [], issueId ?? undefined);

  return (
    <section className="data-check-issues" aria-labelledby="data-check-issues-title">
      <div className="data-check-section-heading">
        <div>
          <h3 id="data-check-issues-title">检查问题</h3>
          <span>每页固定显示 50 条</span>
        </div>
        <div className="data-check-filters">
          <AppSelect
            label="严重程度"
            ariaLabel="严重程度"
            value={severity}
            options={severityOptions}
            onChange={queryState.changeSeverity}
          />
          <AppSelect
            className="data-check-filter--issue-type"
            label="问题类型"
            ariaLabel="问题类型"
            value={issueType}
            options={issueFilterOptions}
            onChange={queryState.changeIssueType}
          />
          <AppSelect
            label="处理状态"
            ariaLabel="处理状态"
            value={status}
            options={statusOptions}
            onChange={queryState.changeStatus}
          />
        </div>
      </div>

      <div className="data-check-table-wrap">
        <table className="data-check-table">
          <thead>
            <tr>
              <th>问题描述</th>
              <th>处理建议</th>
              <th>执行入口</th>
            </tr>
          </thead>
          <tbody>
            {issues.isPending && snapshotId ? (
              <tr>
                <td colSpan={3}>正在加载检查问题…</td>
              </tr>
            ) : null}
            {issues.isError ? (
              <tr>
                <td className="data-check-table__error" colSpan={3}>
                  检查问题加载失败
                </td>
              </tr>
            ) : null}
            {!issues.isPending && !issues.isError && (data?.items.length ?? 0) === 0 ? (
              <tr>
                <td className="data-check-table__empty" colSpan={3}>
                  {snapshotId ? '当前条件下没有检查问题' : '尚无可展示的检查问题'}
                </td>
              </tr>
            ) : null}
            {data?.items.map((current) => (
              <tr
                id={listRecordDomId(current.id)}
                data-current={current.id === issueId ? 'true' : undefined}
                key={current.id}
              >
                <td>
                  <IssueDescription issue={current} />
                </td>
                <td>{current.suggestion}</td>
                <td>
                  {current.status === 'handled' ? (
                    <span className="data-check-handled">已处理</span>
                  ) : (
                    <button
                      className="button button--secondary"
                      type="button"
                      onClick={() => queryState.openIssue(current.id)}
                    >
                      操作
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data ? (
        <ListPagination
          page={data.page}
          totalPages={data.totalPages}
          totalItems={data.totalItems}
          disabled={issues.isFetching}
          onPageChange={queryState.changePage}
        />
      ) : null}
    </section>
  );
}
