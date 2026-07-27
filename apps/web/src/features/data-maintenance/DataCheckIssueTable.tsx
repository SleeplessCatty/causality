import { useIsMutating, useQuery } from '@tanstack/react-query';
import { Fragment } from 'react';
import { useLocation, useSearchParams } from 'react-router';

import {
  dataCheckIssueTypeLabel,
  dataCheckIssueTypeOptions,
  type DataCheckIssueListQuery,
} from '@causality/contracts';
import { AppSelect } from '../../shared/controls/AppSelect';
import { useListPageCorrection } from '../../shared/lists/useListQueryState';
import { ListPagination } from '../../shared/pagination/ListPagination';
import { DataCheckExpandedRow } from './DataCheckExpandedRow';
import { DataCheckIssueSource } from './DataCheckIssueSource';
import { getDataCheckIssues } from './dataMaintenanceApi';
import type { DataCheckQueryState } from './useDataCheckQueryState';

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

const issueFilterOptions = [{ value: '' as const, label: '全部' }, ...dataCheckIssueTypeOptions];

function SeverityBadge({ severity }: { severity: 'error' | 'warning' }) {
  const label = severity === 'error' ? '错误' : '警告';
  return (
    <span className={`data-check-severity data-check-severity--${severity}`} aria-label={label}>
      {label}
    </span>
  );
}

export function DataCheckIssueTable({ snapshotId, queryState }: DataCheckIssueTableProps) {
  const location = useLocation();
  const [, setSearchParameters] = useSearchParams();
  const { page, severity, issueType, status, expandedId } = queryState;
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
  const issueActionPending = useIsMutating({ mutationKey: ['data-checks', 'issue-action'] }) > 0;
  useListPageCorrection({
    requestedPage: page,
    responsePage: data?.page,
    isPlaceholderData: issues.isPlaceholderData,
    setSearchParameters,
    navigationState: location.state,
  });

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
              <th scope="col">严重程度</th>
              <th scope="col">问题类型</th>
              <th scope="col">问题来源</th>
              <th scope="col">处理入口</th>
            </tr>
          </thead>
          <tbody>
            {issues.isPending && snapshotId ? (
              <tr>
                <td colSpan={4}>正在加载检查问题…</td>
              </tr>
            ) : null}
            {issues.isError ? (
              <tr>
                <td className="data-check-table__error" colSpan={4}>
                  检查问题加载失败
                </td>
              </tr>
            ) : null}
            {!issues.isPending && !issues.isError && (data?.items.length ?? 0) === 0 ? (
              <tr>
                <td className="data-check-table__empty" colSpan={4}>
                  {snapshotId ? '当前条件下没有检查问题' : '尚无可展示的检查问题'}
                </td>
              </tr>
            ) : null}
            {data?.items.map((current) => {
              const expanded = current.status === 'open' && expandedId === current.id;
              return (
                <Fragment key={current.id}>
                  <tr className={expanded ? 'data-check-row--expanded' : undefined}>
                    <td>
                      <SeverityBadge severity={current.severity} />
                    </td>
                    <td>{dataCheckIssueTypeLabel(current.issueType)}</td>
                    <td>
                      <DataCheckIssueSource source={current.source} />
                    </td>
                    <td className="data-check-row-actions">
                      {current.status === 'handled' ? (
                        <span className="data-check-handled">已处理</span>
                      ) : (
                        <button
                          className="text-button"
                          type="button"
                          aria-expanded={expanded}
                          disabled={issueActionPending}
                          onClick={() => queryState.toggleExpanded(current.id)}
                        >
                          {expanded ? '收起' : '展开'}
                        </button>
                      )}
                    </td>
                  </tr>
                  {expanded && snapshotId ? (
                    <tr className="data-check-expanded-row">
                      <td colSpan={4}>
                        <DataCheckExpandedRow
                          issue={current}
                          snapshotId={snapshotId}
                          onHandled={queryState.clearExpanded}
                        />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
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
