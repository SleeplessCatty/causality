import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'react-router';

import { OverflowText } from '../../../shared/tooltip/OverflowText';
import { getCase, getCaseRelations } from '../api/caseApi';

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'long',
  timeStyle: 'short',
});

export function CaseDetailPage() {
  const { caseId = '' } = useParams();
  const location = useLocation();
  const detail = useQuery({
    queryKey: ['cases', 'detail', caseId],
    queryFn: ({ signal }) => getCase(caseId, signal),
    enabled: Boolean(caseId),
  });
  const relations = useInfiniteQuery({
    queryKey: ['cases', 'relations', caseId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      getCaseRelations(caseId, { limit: 30, ...(pageParam ? { cursor: pageParam } : {}) }, signal),
    getNextPageParam: (page) => (page.hasMore ? (page.nextCursor ?? undefined) : undefined),
    enabled: Boolean(caseId),
    retry: false,
  });
  const relationItems = Array.from(
    new Map(
      (relations.data?.pages.flatMap((page) => page.items) ?? []).map((relation) => [
        relation.id,
        relation,
      ]),
    ).values(),
  );

  if (detail.isPending) return <div className="page-state">加载案例详情…</div>;
  if (detail.isError) {
    return (
      <div className="page-state page-state--error" role="alert">
        <strong>无法读取案例</strong>
        <Link className="button button--secondary" to="/cases">
          返回案例列表
        </Link>
      </div>
    );
  }

  return (
    <section className="event-detail-page" aria-labelledby="case-detail-title">
      {typeof location.state === 'object' && location.state && 'notice' in location.state ? (
        <div className="success-notice" aria-live="polite">
          {String(location.state.notice)}
        </div>
      ) : null}
      <Link className="back-link" to="/cases">
        <svg aria-hidden="true" viewBox="0 0 20 20">
          <path d="m12.5 4.5-5.5 5.5 5.5 5.5" />
        </svg>
        返回案例列表
      </Link>
      <div className="detail-heading case-detail-heading">
        <div>
          <span className="detail-label">案例内容</span>
          <OverflowText content={detail.data.content} lines={3}>
            <h1 id="case-detail-title">{detail.data.content}</h1>
          </OverflowText>
        </div>
        <Link className="button button--primary" to={`/cases/${detail.data.id}/edit`}>
          编辑案例
        </Link>
      </div>

      <dl className="event-detail-grid case-detail-grid">
        <div>
          <dt>关联关系数</dt>
          <dd>{detail.data.relationCount}</dd>
        </div>
        <div>
          <dt>创建时间</dt>
          <dd>{dateFormatter.format(new Date(detail.data.createdAt))}</dd>
        </div>
        <div>
          <dt>最后更新</dt>
          <dd>{dateFormatter.format(new Date(detail.data.updatedAt))}</dd>
        </div>
      </dl>

      <section className="case-relations" aria-labelledby="case-relations-title">
        <div className="section-heading">
          <h2 id="case-relations-title">关联的因果关系</h2>
          <span>{detail.data.relationCount} 条</span>
        </div>
        {relations.isPending ? <div className="case-relations__state">加载关联关系…</div> : null}
        {relations.isError && !relations.data ? (
          <div className="case-relations__state" role="alert">
            无法读取关联关系
          </div>
        ) : null}
        {relations.isSuccess && relationItems.length === 0 ? (
          <div className="case-relations__state">当前案例尚未关联因果关系</div>
        ) : null}
        {relationItems.length > 0 ? (
          <ul className="case-relation-list">
            {relationItems.map((relation) => (
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
        {relations.isFetchNextPageError ? (
          <div className="case-relations__state case-relations__state--inline" role="alert">
            <span>其余关联关系加载失败，已显示成功加载的内容。</span>
            <button
              type="button"
              className="text-button"
              disabled={relations.isFetchingNextPage}
              onClick={() => void relations.fetchNextPage()}
            >
              {relations.isFetchingNextPage ? '加载中…' : '重试加载其余关联关系'}
            </button>
          </div>
        ) : null}
        {relations.hasNextPage && !relations.isFetchNextPageError ? (
          <div
            className="case-relations__state case-relations__state--inline"
            style={{ justifyContent: 'flex-end' }}
          >
            <button
              type="button"
              className="text-button"
              disabled={relations.isFetchingNextPage}
              onClick={() => void relations.fetchNextPage()}
            >
              {relations.isFetchingNextPage ? '加载中…' : '加载更多'}
            </button>
          </div>
        ) : null}
      </section>
    </section>
  );
}
