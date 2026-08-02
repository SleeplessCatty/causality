import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'react-router';

import { fetchAllRemainingPages } from '../../../shared/pagination/fetchAllRemainingPages';
import { listFocusState, resolveListReturnPath } from '../../../shared/navigation/listReturn';
import { LoadingState } from '../../../shared/loading/LoadingState';
import { OverflowText } from '../../../shared/tooltip/OverflowText';
import { RelationAssociationSection } from '../../relations/components/RelationAssociationSection';
import { getEvent, getEventRelations } from '../api/eventApi';

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'long',
  timeStyle: 'short',
});

function ValueList({ values, empty }: { values: string[]; empty: string }) {
  return values.length > 0 ? (
    <div className="detail-tags">
      {values.map((value) => (
        <OverflowText key={value} content={value}>
          <span>{value}</span>
        </OverflowText>
      ))}
    </div>
  ) : (
    <span className="detail-empty">{empty}</span>
  );
}

export function EventDetailPage() {
  const { eventId = '' } = useParams();
  const location = useLocation();
  const event = useQuery({
    queryKey: ['events', 'detail', eventId],
    queryFn: ({ signal }) => getEvent(eventId, signal),
    enabled: Boolean(eventId),
  });
  const relations = useInfiniteQuery({
    queryKey: ['events', 'relations', eventId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      getEventRelations(eventId, pageParam ? { cursor: pageParam } : {}, signal),
    getNextPageParam: (page) => (page.hasMore ? (page.nextCursor ?? undefined) : undefined),
    enabled: Boolean(eventId) && event.isSuccess && event.data.relationCount > 0,
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
  const listReturnTo = resolveListReturnPath(location.state, '/events', event.data?.listPage ?? 1);
  const focusState = listFocusState(eventId);

  return (
    <LoadingState
      pending={event.isPending}
      fetching={event.isFetching}
      hasData={Boolean(event.data) || event.isError}
      error={null}
      skeleton="detail"
      onRetry={() => void event.refetch()}
    >
      {event.isError ? (
        <div className="page-state page-state--error" role="alert">
          <strong>无法读取事件</strong>
          <Link className="button button--secondary" to={listReturnTo} state={focusState}>
            返回事件列表
          </Link>
        </div>
      ) : event.data ? (
        <section className="event-detail-page" aria-labelledby="event-detail-title">
          {typeof location.state === 'object' && location.state && 'notice' in location.state ? (
            <div className="success-notice" aria-live="polite">
              {String(location.state.notice)}
            </div>
          ) : null}
          <Link className="back-link" to={listReturnTo} state={focusState}>
            <svg aria-hidden="true" viewBox="0 0 20 20">
              <path d="m12.5 4.5-5.5 5.5 5.5 5.5" />
            </svg>
            返回事件列表
          </Link>
          <div className="detail-heading">
            <div>
              <span className="detail-label">原子事件</span>
              <OverflowText content={event.data.name} lines={2}>
                <h1 id="event-detail-title">{event.data.name}</h1>
              </OverflowText>
            </div>
            <Link
              className="button button--primary"
              to={`/events/${event.data.id}/edit`}
              state={{ listReturnPath: listReturnTo, listFocusId: event.data.id }}
            >
              编辑事件
            </Link>
          </div>
          <dl className="event-detail-grid">
            <div className="detail-wide">
              <dt>事件说明</dt>
              <dd>
                {event.data.description ? (
                  <OverflowText content={event.data.description} lines={6}>
                    <span>{event.data.description}</span>
                  </OverflowText>
                ) : (
                  <span className="detail-empty">未填写</span>
                )}
              </dd>
            </div>
            <div>
              <dt>别名</dt>
              <dd>
                <ValueList values={event.data.aliases} empty="未填写" />
              </dd>
            </div>
            <div>
              <dt>关键词</dt>
              <dd>
                <ValueList values={event.data.keywords} empty="未填写" />
              </dd>
            </div>
            <div>
              <dt>创建时间</dt>
              <dd>{dateFormatter.format(new Date(event.data.createdAt))}</dd>
            </div>
            <div>
              <dt>最后更新</dt>
              <dd>{dateFormatter.format(new Date(event.data.updatedAt))}</dd>
            </div>
          </dl>

          <RelationAssociationSection
            titleId="event-relations-title"
            totalCount={event.data.relationCount}
            items={relationItems}
            emptyMessage="当前原子事件尚未关联因果关系"
            isPending={event.data.relationCount > 0 && relations.isPending}
            isInitialError={relations.isError && !relations.data}
            isFetchNextPageError={relations.isFetchNextPageError}
            isFetchingNextPage={relations.isFetchingNextPage}
            hasNextPage={relations.hasNextPage}
            onRetryInitial={() => void relations.refetch()}
            onLoadRemaining={() => void fetchAllRemainingPages(relations.fetchNextPage)}
          />
        </section>
      ) : null}
    </LoadingState>
  );
}
