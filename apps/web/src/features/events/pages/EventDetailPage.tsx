import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'react-router';

import { getEvent } from '../api/eventApi';

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'long',
  timeStyle: 'short',
});

function ValueList({ values, empty }: { values: string[]; empty: string }) {
  return values.length > 0 ? (
    <div className="detail-tags">
      {values.map((value) => (
        <span key={value}>{value}</span>
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
        <h1 id="event-detail-title">{event.data.name}</h1>
        <Link className="button button--primary" to={`/events/${event.data.id}/edit`}>
          编辑事件
        </Link>
      </div>
      <dl className="event-detail-grid">
        <div className="detail-wide">
          <dt>事件说明</dt>
          <dd>{event.data.description ?? <span className="detail-empty">未填写</span>}</dd>
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
    </section>
  );
}
