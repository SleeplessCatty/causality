import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

import type {
  DataCheckIssue,
  DataCheckIssueListQuery,
  DataCheckIssueListResponse,
  DataCheckIssueStatus,
  DataCheckSeverity,
} from '@causality/contracts';
import { AppSelect } from '../../shared/controls/AppSelect';
import { ListPagination } from '../../shared/pagination/ListPagination';
import {
  autoHandleDataCheckIssue,
  getDataCheckIssues,
  manualHandleDataCheckIssue,
} from './dataMaintenanceApi';

interface DataCheckIssueTableProps {
  snapshotId: string | null;
}

interface IssueFilters {
  severity: DataCheckSeverity | '';
  issueType: string;
  status: DataCheckIssueStatus | '';
}

const issueTypeOptions = [
  ['delete_missing_alias', '失效别名'],
  ['delete_missing_keyword', '失效关键词'],
  ['delete_missing_relation_case', '失效关系案例关联'],
  ['relation_self_loop', '关系自环'],
  ['relation_confidence_range', '置信度范围'],
  ['duplicate_relation_direction', '同方向重复关系'],
  ['duplicate_event_name', '重复事件名称'],
  ['duplicate_case_content', '重复案例内容'],
  ['delete_duplicate_alias', '重复别名'],
  ['delete_duplicate_keyword', '重复关键词'],
  ['resequence_keywords', '关键词位置'],
  ['invalid_event_name', '事件名称异常'],
  ['invalid_case_content', '案例内容异常'],
  ['invalid_alias_text', '别名内容异常'],
  ['invalid_keyword_text', '关键词内容异常'],
  ['invalid_event_description', '事件说明异常'],
  ['invalid_relation_description', '关系说明异常'],
  ['invalid_event_timestamp_order', '事件时间异常'],
  ['invalid_relation_timestamp_order', '关系时间异常'],
  ['invalid_case_timestamp_order', '案例时间异常'],
  ['cross_event_alias_name', '别名与事件名称冲突'],
  ['cross_event_shared_alias', '跨事件共享别名'],
] as const;

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
  ...issueTypeOptions.map(([value, label]) => ({ value, label })),
];

function targetPath(issue: DataCheckIssue): { href: string; label: string } | null {
  switch (issue.targetType) {
    case 'event':
      return { href: `/events/${issue.targetId}`, label: '查看原子事件' };
    case 'relation':
      return { href: `/relations/${issue.targetId}`, label: '查看因果关系' };
    case 'case':
      return { href: `/cases/${issue.targetId}`, label: '查看具体案例' };
    case 'alias':
    case 'keyword':
      return issue.relatedId
        ? { href: `/events/${issue.relatedId}`, label: '查看所属原子事件' }
        : null;
    case 'relation_case':
      return null;
  }
}

function relatedPath(issue: DataCheckIssue): { href: string; label: string } | null {
  if (!issue.relatedId) return null;
  switch (issue.issueType) {
    case 'duplicate_relation_direction':
      return { href: `/relations/${issue.relatedId}`, label: '查看保留关系' };
    case 'duplicate_event_name':
    case 'cross_event_alias_name':
    case 'cross_event_shared_alias':
      return { href: `/events/${issue.relatedId}`, label: '查看相关事件' };
    case 'duplicate_case_content':
      return { href: `/cases/${issue.relatedId}`, label: '查看相关案例' };
    default:
      return null;
  }
}

function IssueDescription({ issue }: { issue: DataCheckIssue }) {
  const target = targetPath(issue);
  const related = relatedPath(issue);
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
        {target ? <Link to={target.href}>{target.label}</Link> : <code>{issue.targetId}</code>}
        {related ? <Link to={related.href}>{related.label}</Link> : null}
        {!related && issue.relatedId ? <code>{issue.relatedId}</code> : null}
      </div>
    </div>
  );
}

export function DataCheckIssueTable({ snapshotId }: DataCheckIssueTableProps) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<IssueFilters>({
    severity: '',
    issueType: '',
    status: '',
  });
  const queryKey = [
    'data-checks',
    'issues',
    {
      snapshotId,
      page,
      severity: filters.severity,
      issueType: filters.issueType,
      status: filters.status,
    },
  ] as const;
  const issues = useQuery({
    queryKey,
    enabled: snapshotId !== null,
    queryFn: ({ signal }) => {
      const query: DataCheckIssueListQuery = {
        page,
        ...(filters.severity ? { severity: filters.severity } : {}),
        ...(filters.issueType ? { issueType: filters.issueType } : {}),
        ...(filters.status ? { status: filters.status } : {}),
      };
      return getDataCheckIssues(query, signal);
    },
  });
  const [pendingIssueId, setPendingIssueId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const handleIssue = useMutation({
    mutationFn: async (current: DataCheckIssue) => {
      setPendingIssueId(current.id);
      setActionError(null);
      return current.actionMode === 'auto'
        ? autoHandleDataCheckIssue(current.id, current.snapshotId)
        : manualHandleDataCheckIssue(current.id, current.snapshotId);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<DataCheckIssueListResponse>(queryKey, (current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) => (item.id === updated.id ? updated : item)),
            }
          : current,
      );
      void queryClient.invalidateQueries({ queryKey: ['data-checks', 'latest'] });
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : '处理失败，请稍后重试');
    },
    onSettled: () => {
      setPendingIssueId(null);
    },
  });

  function updateFilter<Key extends keyof IssueFilters>(key: Key, value: IssueFilters[Key]): void {
    setPage(1);
    setFilters((current) => ({ ...current, [key]: value }));
  }

  const data = issues.data;
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
            value={filters.severity}
            options={severityOptions}
            onChange={(value) => updateFilter('severity', value)}
          />
          <AppSelect
            className="data-check-filter--issue-type"
            label="问题类型"
            ariaLabel="问题类型"
            value={filters.issueType}
            options={issueFilterOptions}
            onChange={(value) => updateFilter('issueType', value)}
          />
          <AppSelect
            label="处理状态"
            ariaLabel="处理状态"
            value={filters.status}
            options={statusOptions}
            onChange={(value) => updateFilter('status', value)}
          />
        </div>
      </div>

      {actionError ? (
        <div className="data-check-action-error" role="alert">
          {actionError}
        </div>
      ) : null}

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
              <tr key={current.id}>
                <td>
                  <IssueDescription issue={current} />
                </td>
                <td>{current.suggestion}</td>
                <td>
                  {current.status === 'handled' ? (
                    <span className="data-check-handled">已处理</span>
                  ) : (
                    <button
                      className={
                        current.actionMode === 'auto'
                          ? 'button button--primary'
                          : 'button button--secondary'
                      }
                      type="button"
                      disabled={handleIssue.isPending}
                      onClick={() => handleIssue.mutate(current)}
                    >
                      {pendingIssueId === current.id
                        ? '处理中…'
                        : current.actionMode === 'auto'
                          ? '自动处理'
                          : '手动处理'}
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
          onPageChange={setPage}
        />
      ) : null}
    </section>
  );
}
