import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'react-router';

import { fetchAllRemainingPages } from '../../../shared/pagination/fetchAllRemainingPages';
import { OverflowText } from '../../../shared/tooltip/OverflowText';
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
    enabled: Boolean(eventId),
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

  if (event.isPending) return <div className="page-state">加载事件详情…</div>;
  if (event.isError) {
    return (
      <div className="page-state page-state--error" role="alert">
        <strong>无法读取事件</strong>
        <Link className="button button--secondary" to="/events">
          返回事件列表
        </Link>
      </div>
    );
  }

  return (
    <section className="event-detail-page" aria-labelledby="event-detail-title">
      {typeof location.state === 'object' && location.state && 'notice' in location.state ? (
        <div className="success-notice" aria-live="polite">
          {String(location.state.notice)}
        </div>
      ) : null}
      <Link className="back-link" to="/events">
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
        <Link className="button button--primary" to={`/events/${event.data.id}/edit`}>
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

      <section className="case-relations" aria-labelledby="event-relations-title">
        <div className="section-heading">
          <h2 id="event-relations-title">关联的因果关系</h2>
          <span>{event.data.relationCount} 条</span>
        </div>
        {relations.isPending ? <div className="case-relations__state">加载关联关系…</div> : null}
        {relations.isError && !relations.data ? (
          <div className="case-relations__state" role="alert">
            无法读取关联关系
          </div>
        ) : null}
        {relations.isSuccess && relationItems.length === 0 ? (
          <div className="case-relations__state">当前原子事件尚未关联因果关系</div>
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
              onClick={() => void fetchAllRemainingPages(relations.fetchNextPage)}
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
              onClick={() => void fetchAllRemainingPages(relations.fetchNextPage)}
            >
              {relations.isFetchingNextPage ? '加载中…' : '加载更多'}
            </button>
          </div>
        ) : null}
      </section>
    </section>
  );
}
