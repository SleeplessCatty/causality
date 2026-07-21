import type { CausalGraphResponse } from '@causality/contracts';

import { graphQueryStatus, type GraphLimit, type GraphQueryState } from '../graph/graphQueryState';

export type GraphQueryErrorKind = 'query' | 'layout' | null;

interface GraphQueryStatusProps {
  displayedGraph: CausalGraphResponse | null;
  requestedQuery: GraphQueryState;
  isPending: boolean;
  errorKind: GraphQueryErrorKind;
  onExpand: (limit: GraphLimit) => void;
  onAdjustFilter: () => void;
  onRetry: () => void;
}

export function GraphQueryStatus({
  displayedGraph,
  requestedQuery,
  isPending,
  errorKind,
  onExpand,
  onAdjustFilter,
  onRetry,
}: GraphQueryStatusProps) {
  if (!displayedGraph) return null;
  const status = graphQueryStatus(displayedGraph);

  return (
    <div className="graph-query-status" aria-live="polite">
      <div className="graph-query-status__context">
        <strong>{requestedQuery.limit} 节点档</strong>
        <span>
          {displayedGraph.meta.nodeCount} 个节点 · {displayedGraph.meta.relationCount} 条关系
        </span>
        {requestedQuery.minConfidence > 0 ? (
          <span>置信度 ≥ {requestedQuery.minConfidence}%</span>
        ) : null}
        {requestedQuery.minCaseCount > 0 ? <span>案例 ≥ {requestedQuery.minCaseCount}</span> : null}
      </div>
      <div className="graph-query-status__result">
        {errorKind ? (
          <>
            <span className="is-error">
              {errorKind === 'query'
                ? '查询失败，仍显示上一查询结果'
                : '布局失败，仍显示上一查询结果'}
            </span>
            <button type="button" onClick={onRetry}>
              重试
            </button>
          </>
        ) : (
          <>
            <span>{isPending ? '正在重新生成局部图' : status.message}</span>
            {status.action === 'expand' ? (
              <button
                type="button"
                disabled={isPending}
                aria-label={
                  isPending
                    ? `正在扩展至 ${status.nextLimit} 节点`
                    : `扩展至 ${status.nextLimit} 节点`
                }
                onClick={() => onExpand(status.nextLimit)}
              >
                {isPending ? '正在扩展…' : `扩展至 ${status.nextLimit} 节点`}
              </button>
            ) : null}
            {status.action === 'adjust_filter' ? (
              <button type="button" disabled={isPending} onClick={onAdjustFilter}>
                调整筛选
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
