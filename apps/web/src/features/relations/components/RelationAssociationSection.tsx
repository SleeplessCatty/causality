import { Link } from 'react-router';

import { OverflowText } from '../../../shared/tooltip/OverflowText';

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'long',
  timeStyle: 'short',
});

interface RelationAssociationItem {
  id: string;
  causeEvent: { id: string; name: string };
  effectEvent: { id: string; name: string };
  linkedAt: string;
}

export interface RelationAssociationSectionProps {
  titleId: string;
  totalCount: number;
  items: RelationAssociationItem[];
  emptyMessage: string;
  isPending: boolean;
  isInitialError: boolean;
  isFetchNextPageError: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  onRetryInitial: () => void;
  onLoadRemaining: () => void;
}

export function RelationAssociationSection({
  titleId,
  totalCount,
  items,
  emptyMessage,
  isPending,
  isInitialError,
  isFetchNextPageError,
  isFetchingNextPage,
  hasNextPage,
  onRetryInitial,
  onLoadRemaining,
}: RelationAssociationSectionProps) {
  return (
    <section className="case-relations" aria-labelledby={titleId}>
      <div className="section-heading">
        <h2 id={titleId}>关联的因果关系</h2>
        <span>{totalCount} 条</span>
      </div>
      {isPending ? <div className="case-relations__state">加载关联关系…</div> : null}
      {isInitialError ? (
        <div className="case-relations__state case-relations__state--inline" role="alert">
          <span>无法读取关联关系</span>
          <button type="button" className="text-button" onClick={onRetryInitial}>
            重新加载
          </button>
        </div>
      ) : null}
      {!isPending && !isInitialError && items.length === 0 ? (
        <div className="case-relations__state">{emptyMessage}</div>
      ) : null}
      {items.length > 0 ? (
        <ul className="case-relation-list">
          {items.map((relation) => (
            <li key={relation.id}>
              <Link className="case-relation-list__relation" to={`/relations/${relation.id}`}>
                <OverflowText content={relation.causeEvent.name}>
                  <span>{relation.causeEvent.name}</span>
                </OverflowText>
                <strong aria-hidden="true">→</strong>
                <OverflowText content={relation.effectEvent.name}>
                  <span>{relation.effectEvent.name}</span>
                </OverflowText>
              </Link>
              <time dateTime={relation.linkedAt}>
                关联于 {dateFormatter.format(new Date(relation.linkedAt))}
              </time>
            </li>
          ))}
        </ul>
      ) : null}
      {isFetchNextPageError ? (
        <div className="case-relations__state case-relations__state--inline" role="alert">
          <span>其余关联关系加载失败，已显示成功加载的内容。</span>
          <button
            type="button"
            className="text-button"
            disabled={isFetchingNextPage}
            onClick={onLoadRemaining}
          >
            {isFetchingNextPage ? '加载中…' : '重试加载其余关联关系'}
          </button>
        </div>
      ) : null}
      {hasNextPage && !isFetchNextPageError ? (
        <div
          className="case-relations__state case-relations__state--inline"
          style={{ justifyContent: 'flex-end' }}
        >
          <button
            type="button"
            className="text-button"
            disabled={isFetchingNextPage}
            onClick={onLoadRemaining}
          >
            {isFetchingNextPage ? '加载中…' : '加载更多'}
          </button>
        </div>
      ) : null}
    </section>
  );
}
