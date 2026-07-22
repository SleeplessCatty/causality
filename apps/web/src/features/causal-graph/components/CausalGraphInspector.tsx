import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';

import { getEvent } from '../../events/api/eventApi';
import { getRelation } from '../../relations/api/relationApi';
import type { GraphElementSelection } from '../graph/graphSelection';

interface CausalGraphInspectorProps {
  open: boolean;
  selection: GraphElementSelection | null;
  centerEventId: string;
  onClose(): void;
  onSetCenter(eventId: string): void;
}

function DetailError({ onRetry }: { onRetry(): void }) {
  return (
    <div className="causal-graph-inspector__state" role="alert">
      <strong>无法加载详情</strong>
      <span>请确认服务连接后重试。</span>
      <button className="button button--secondary" type="button" onClick={onRetry}>
        重试
      </button>
    </div>
  );
}

export function CausalGraphInspector({
  open,
  selection,
  centerEventId,
  onClose,
  onSetCenter,
}: CausalGraphInspectorProps) {
  const eventId = selection?.type === 'node' ? selection.id : '';
  const relationId = selection?.type === 'relation' ? selection.id : '';
  const event = useQuery({
    queryKey: ['events', 'detail', eventId],
    queryFn: ({ signal }) => getEvent(eventId, signal),
    enabled: open && Boolean(eventId),
  });
  const relation = useQuery({
    queryKey: ['relations', 'detail', relationId],
    queryFn: ({ signal }) => getRelation(relationId, signal),
    enabled: open && Boolean(relationId),
  });

  return (
    <aside
      className={`causal-graph-inspector${open ? ' is-open' : ''}`}
      aria-label="图元素详情"
      aria-hidden={!open}
      inert={!open}
    >
      <header className="causal-graph-inspector__header">
        <div>
          <span>{selection?.type === 'relation' ? '因果关系' : '原子事件'}</span>
          <strong>详情检查器</strong>
        </div>
        <button type="button" aria-label="关闭详情检查器" onClick={onClose}>
          ×
        </button>
      </header>

      {!selection ? (
        <div className="causal-graph-inspector__state is-empty">
          <strong>请选择节点或关系</strong>
          <span>点击图中元素，或使用方向键移动选择。</span>
        </div>
      ) : null}

      {selection?.type === 'node' && event.isPending ? (
        <div className="causal-graph-inspector__skeleton" role="status" aria-label="加载事件详情">
          <i />
          <i />
          <i />
        </div>
      ) : null}
      {selection?.type === 'node' && event.isError ? (
        <DetailError onRetry={() => void event.refetch()} />
      ) : null}
      {selection?.type === 'node' && event.data ? (
        <div className="causal-graph-inspector__body">
          <div className="causal-graph-inspector__title">
            <span>事件节点</span>
            <h2>{event.data.name}</h2>
          </div>
          <section>
            <h3>事件说明</h3>
            <p>{event.data.description ?? '未填写'}</p>
          </section>
          <section>
            <h3>别名</h3>
            {event.data.aliases.length ? (
              <div className="causal-graph-inspector__tags">
                {event.data.aliases.map((alias) => (
                  <span key={alias}>{alias}</span>
                ))}
              </div>
            ) : (
              <p className="is-muted">未填写</p>
            )}
          </section>
          <section>
            <h3>关键词</h3>
            {event.data.keywords.length ? (
              <div className="causal-graph-inspector__tags">
                {event.data.keywords.map((keyword) => (
                  <span key={keyword}>{keyword}</span>
                ))}
              </div>
            ) : (
              <p className="is-muted">未填写</p>
            )}
          </section>
          {event.data.id === centerEventId ? (
            <div className="causal-graph-inspector__center-status">当前中心事件</div>
          ) : (
            <button
              className="button button--primary causal-graph-inspector__primary-action"
              type="button"
              onClick={() => onSetCenter(event.data.id)}
            >
              设为中心事件
            </button>
          )}
        </div>
      ) : null}

      {selection?.type === 'relation' && relation.isPending ? (
        <div className="causal-graph-inspector__skeleton" role="status" aria-label="加载关系详情">
          <i />
          <i />
          <i />
        </div>
      ) : null}
      {selection?.type === 'relation' && relation.isError ? (
        <DetailError onRetry={() => void relation.refetch()} />
      ) : null}
      {selection?.type === 'relation' && relation.data ? (
        <div className="causal-graph-inspector__body">
          <div className="causal-graph-inspector__title">
            <span>有向关系</span>
            <h2>
              {relation.data.causeEvent.name} → {relation.data.effectEvent.name}
            </h2>
          </div>
          <dl className="causal-graph-inspector__metrics">
            <div>
              <dt>置信度</dt>
              <dd>{relation.data.confidence}%</dd>
            </div>
            <div>
              <dt>具体案例</dt>
              <dd>{relation.data.caseCount} 条</dd>
            </div>
          </dl>
          <section>
            <h3>关系说明</h3>
            <p>{relation.data.description ?? '未填写'}</p>
          </section>
          <section>
            <h3>最近案例</h3>
            {relation.data.recentCases.length ? (
              <ul className="causal-graph-inspector__cases">
                {relation.data.recentCases.map((item) => (
                  <li key={item.id}>
                    <Link to={`/cases/${item.id}`}>{item.content}</Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="is-muted">暂无具体案例</p>
            )}
            {relation.data.caseCount > 5 ? (
              <Link
                className="causal-graph-inspector__all-cases"
                to={`/cases?relationId=${relation.data.id}`}
              >
                查看全部 {relation.data.caseCount} 条
              </Link>
            ) : null}
          </section>
        </div>
      ) : null}
    </aside>
  );
}
