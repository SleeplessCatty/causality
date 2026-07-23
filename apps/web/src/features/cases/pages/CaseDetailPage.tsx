import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'react-router';

import { OverflowText } from '../../../shared/tooltip/OverflowText';
import { fetchAllRemainingPages } from '../../../shared/pagination/fetchAllRemainingPages';
import { listFocusState, resolveListReturnPath } from '../../../shared/navigation/listReturn';
import { RelationAssociationSection } from '../../relations/components/RelationAssociationSection';
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
      getCaseRelations(caseId, pageParam ? { cursor: pageParam } : {}, signal),
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
  const listReturnTo = resolveListReturnPath(location.state, '/cases', detail.data?.listPage ?? 1);
  const focusState = listFocusState(caseId);

  if (detail.isPending) return <div className="page-state">加载案例详情…</div>;
  if (detail.isError) {
    return (
      <div className="page-state page-state--error" role="alert">
        <strong>无法读取案例</strong>
        <Link className="button button--secondary" to={listReturnTo} state={focusState}>
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
      <Link className="back-link" to={listReturnTo} state={focusState}>
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
        <Link
          className="button button--primary"
          to={`/cases/${detail.data.id}/edit`}
          state={{ listReturnPath: listReturnTo, listFocusId: detail.data.id }}
        >
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

      <RelationAssociationSection
        titleId="case-relations-title"
        totalCount={detail.data.relationCount}
        items={relationItems}
        emptyMessage="当前案例尚未关联因果关系"
        isPending={relations.isPending}
        isInitialError={relations.isError && !relations.data}
        isFetchNextPageError={relations.isFetchNextPageError}
        isFetchingNextPage={relations.isFetchingNextPage}
        hasNextPage={relations.hasNextPage}
        onRetryInitial={() => void relations.refetch()}
        onLoadRemaining={() => void fetchAllRemainingPages(relations.fetchNextPage)}
      />
    </section>
  );
}
