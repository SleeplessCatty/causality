import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Link, useLocation, useParams } from 'react-router';

import { OverflowText } from '../../../shared/tooltip/OverflowText';
import { getRelation, getRelationCases } from '../api/relationApi';

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'long',
  timeStyle: 'short',
});

export function RelationDetailPage() {
  const { relationId = '' } = useParams();
  const location = useLocation();
  const relation = useQuery({
    queryKey: ['relations', 'detail', relationId],
    queryFn: ({ signal }) => getRelation(relationId, signal),
    enabled: Boolean(relationId),
  });
  const linkedCases = useInfiniteQuery({
    queryKey: ['cases', 'relation-associations', relationId],
    queryFn: ({ pageParam, signal }) =>
      getRelationCases(
        relationId,
        { limit: 100, ...(pageParam ? { cursor: pageParam } : {}) },
        signal,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => (page.hasMore ? (page.nextCursor ?? undefined) : undefined),
    enabled: relation.isSuccess && relation.data.caseCount > 0,
    retry: false,
  });

  const cases = useMemo(() => {
    const unique = new Map<
      string,
      NonNullable<typeof linkedCases.data>['pages'][number]['items'][number]
    >();
    for (const page of linkedCases.data?.pages ?? []) {
      for (const item of page.items) unique.set(item.id, item);
    }
    return [...unique.values()];
  }, [linkedCases.data?.pages]);

  if (relation.isPending) return <div className="page-state">加载因果关系详情…</div>;
  if (relation.isError) {
    return (
      <div className="page-state page-state--error" role="alert">
        <strong>无法读取因果关系</strong>
        <Link className="button button--secondary" to="/relations">
          返回关系列表
        </Link>
      </div>
    );
  }

  return (
    <section
      className="event-detail-page relation-detail-page"
      aria-labelledby="relation-detail-title"
    >
      {typeof location.state === 'object' && location.state && 'notice' in location.state ? (
        <div className="success-notice" aria-live="polite">
          {String(location.state.notice)}
        </div>
      ) : null}
      <Link className="back-link" to="/relations">
        <svg aria-hidden="true" viewBox="0 0 20 20">
          <path d="m12.5 4.5-5.5 5.5 5.5 5.5" />
        </svg>
        返回关系列表
      </Link>
      <div className="detail-heading relation-detail-heading">
        <div>
          <span className="detail-label">因果关系</span>
          <h1 id="relation-detail-title">
            <OverflowText content={relation.data.causeEvent.name} lines={2}>
              <Link to={`/events/${relation.data.causeEvent.id}`}>
                {relation.data.causeEvent.name}
              </Link>
            </OverflowText>
            <span aria-hidden="true">→</span>
            <OverflowText content={relation.data.effectEvent.name} lines={2}>
              <Link to={`/events/${relation.data.effectEvent.id}`}>
                {relation.data.effectEvent.name}
              </Link>
            </OverflowText>
          </h1>
        </div>
        <Link className="button button--primary" to={`/relations/${relation.data.id}/edit`}>
          编辑因果关系
        </Link>
      </div>

      <dl className="event-detail-grid relation-detail-grid">
        <div className="detail-wide">
          <dt>关系说明</dt>
          <dd>
            {relation.data.description ? (
              <OverflowText content={relation.data.description} lines={6}>
                <span>{relation.data.description}</span>
              </OverflowText>
            ) : (
              <span className="detail-empty">未填写</span>
            )}
          </dd>
        </div>
        <div>
          <dt>置信度</dt>
          <dd className="confidence-value">{relation.data.confidence}%</dd>
        </div>
        <div>
          <dt>具体案例</dt>
          <dd>{relation.data.caseCount} 条</dd>
        </div>
        <div>
          <dt>创建时间</dt>
          <dd>{dateFormatter.format(new Date(relation.data.createdAt))}</dd>
        </div>
        <div>
          <dt>最后更新</dt>
          <dd>{dateFormatter.format(new Date(relation.data.updatedAt))}</dd>
        </div>
      </dl>

      <section
        className="case-relations relation-detail-cases"
        aria-labelledby="relation-cases-title"
      >
        <div className="section-heading">
          <h2 id="relation-cases-title">关联的具体案例</h2>
          <span>{relation.data.caseCount} 条</span>
        </div>
        {relation.data.caseCount === 0 ? (
          <div className="case-relations__state">尚未关联具体案例</div>
        ) : (
          <>
            {linkedCases.isPending ? (
              <div className="case-relations__state">加载具体案例…</div>
            ) : null}
            {linkedCases.isError && !linkedCases.data ? (
              <div className="case-relations__state" role="alert">
                <span>无法读取具体案例</span>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => void linkedCases.refetch()}
                >
                  重新加载
                </button>
              </div>
            ) : null}
            {cases.length > 0 ? (
              <ul className="case-relation-list relation-detail-case-list">
                {cases.map((item) => (
                  <li key={item.id}>
                    <OverflowText content={item.content} lines={2}>
                      <Link to={`/cases/${item.id}`}>{item.content}</Link>
                    </OverflowText>
                  </li>
                ))}
              </ul>
            ) : null}
            {linkedCases.isFetchingNextPage ? (
              <div className="case-relations__state">正在加载其余案例…</div>
            ) : null}
            {linkedCases.hasNextPage &&
            !linkedCases.isFetchingNextPage &&
            !linkedCases.isFetchNextPageError ? (
              <button
                type="button"
                className="text-button"
                onClick={() => void linkedCases.fetchNextPage()}
              >
                加载更多
              </button>
            ) : null}
            {linkedCases.isFetchNextPageError ? (
              <div className="case-relations__state case-relations__state--inline" role="alert">
                <span>其余案例加载失败，已显示成功加载的内容。</span>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => void linkedCases.fetchNextPage()}
                >
                  重试加载其余案例
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>
    </section>
  );
}
