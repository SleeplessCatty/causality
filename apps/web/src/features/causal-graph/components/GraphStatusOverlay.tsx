import type { CausalGraphResponse } from '@causality/contracts';

export type GraphQueryErrorKind = 'query' | 'layout' | null;

interface GraphStatusOverlayProps {
  graph: CausalGraphResponse | null;
  isPending: boolean;
  errorKind: GraphQueryErrorKind;
  empty: boolean;
  onRetry: () => void;
}

export function GraphStatusOverlay({
  graph,
  isPending,
  errorKind,
  empty,
  onRetry,
}: GraphStatusOverlayProps) {
  return (
    <aside className="graph-status-overlay" aria-label="因果图状态" aria-live="polite">
      {empty ? <span>请选择中心事件</span> : null}
      {graph ? (
        <>
          <span>节点 {graph.meta.nodeCount}</span>
          <span>关系 {graph.meta.relationCount}</span>
        </>
      ) : null}
      {isPending ? <strong>更新中</strong> : null}
      {errorKind ? (
        <>
          <strong>{errorKind === 'query' ? '查询失败，保留当前图' : '布局失败，保留当前图'}</strong>
          <button type="button" aria-label="重试因果图查询" onClick={onRetry}>
            重试
          </button>
        </>
      ) : null}
    </aside>
  );
}
