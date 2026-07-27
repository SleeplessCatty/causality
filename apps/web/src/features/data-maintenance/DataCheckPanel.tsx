import { Link } from 'react-router';

import type { DataCheckLatestResponse, DataCheckSnapshotSummary } from '@causality/contracts';
import { DataCheckIssueTable } from './DataCheckIssueTable';
import type { DataCheckQueryState } from './useDataCheckQueryState';

interface DataCheckPanelProps {
  latest: DataCheckLatestResponse | undefined;
  loading: boolean;
  error: string | null;
  checking: boolean;
  onCheck: () => void;
  queryState: DataCheckQueryState;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(value));
}

function OrphanCards({ snapshot }: { snapshot: DataCheckSnapshotSummary }) {
  return (
    <div className="data-check-orphan-grid" aria-label="孤立数据统计">
      <Link className="data-check-orphan-card" to="/events?orphan=true">
        <span>孤立原子事件</span>
        <strong>{snapshot.orphanEventCount}</strong>
        <small>查看并手动处理</small>
      </Link>
      <Link className="data-check-orphan-card" to="/relations?orphan=true">
        <span>无案例因果关系</span>
        <strong>{snapshot.orphanRelationCount}</strong>
        <small>查看并手动处理</small>
      </Link>
      <Link className="data-check-orphan-card" to="/cases?orphan=true">
        <span>孤立具体案例</span>
        <strong>{snapshot.orphanCaseCount}</strong>
        <small>查看并手动处理</small>
      </Link>
    </div>
  );
}

function SnapshotSummary({ snapshot }: { snapshot: DataCheckSnapshotSummary }) {
  const metrics = [
    ['错误', snapshot.errorCount, 'negative'],
    ['警告', snapshot.warningCount, 'warning'],
    ['未处理', snapshot.openCount, 'neutral'],
    ['已处理', snapshot.handledCount, 'positive'],
  ] as const;
  return (
    <>
      <div className="data-check-metrics" aria-label="检查问题汇总">
        {metrics.map(([label, value, tone]) => (
          <div className={`data-check-metric data-check-metric--${tone}`} key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <OrphanCards snapshot={snapshot} />
    </>
  );
}

function semanticStatusLabel(snapshot: DataCheckSnapshotSummary): string {
  switch (snapshot.semanticStatus) {
    case 'completed':
      return '语义查重已完成';
    case 'truncated':
      return '语义查重结果已截断';
    case 'failed':
      return '语义查重未完成';
    case 'skipped':
      return '语义查重已跳过';
  }
}

export function DataCheckPanel({
  latest,
  loading,
  error,
  checking,
  onCheck,
  queryState,
}: DataCheckPanelProps) {
  const snapshot = latest?.snapshot ?? null;
  const running = latest?.task.status === 'running';
  return (
    <section className="data-check-panel" aria-label="数据检查">
      <div className="data-check-panel-toolbar">
        <div className="data-check-heading-actions">
          <button
            className="data-check-run-button"
            type="button"
            onClick={onCheck}
            disabled={checking}
          >
            {checking ? '检查中…' : '检查数据'}
          </button>
          <span
            className={`data-check-task-state${running ? ' data-check-task-state--running' : ''}`}
            aria-live="polite"
          >
            {running
              ? '数据检查进行中'
              : latest?.task.status === 'failed'
                ? '最近检查失败'
                : latest?.task.status === 'succeeded'
                  ? '检查完成'
                  : '等待检查'}
          </span>
        </div>
      </div>

      {loading ? <div className="data-check-empty">正在读取最近检查结果…</div> : null}
      {error ? (
        <div className="data-check-load-error" role="alert">
          {error}
        </div>
      ) : null}
      {!loading && !snapshot ? (
        <div className="data-check-empty">
          <strong>尚未执行数据检查</strong>
          <span>点击“检查数据”后生成第一份统计和问题结果。</span>
        </div>
      ) : null}

      {snapshot ? (
        <>
          <div className="data-check-success">
            <span>最近成功检查</span>
            <time dateTime={snapshot.checkedAt}>{formatDateTime(snapshot.checkedAt)}</time>
            <span>{semanticStatusLabel(snapshot)}</span>
          </div>
          <SnapshotSummary snapshot={snapshot} />
        </>
      ) : null}

      {latest?.latestFailure ? (
        <div className="data-check-failure" role="status">
          <div>
            <strong>最近失败</strong>
            <time dateTime={latest.latestFailure.failedAt}>
              {formatDateTime(latest.latestFailure.failedAt)}
            </time>
          </div>
          <p>{latest.latestFailure.message}</p>
        </div>
      ) : null}

      <DataCheckIssueTable snapshotId={snapshot?.snapshotId ?? null} queryState={queryState} />
    </section>
  );
}
