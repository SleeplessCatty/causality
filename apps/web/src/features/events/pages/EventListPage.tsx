import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { getEvents } from '../api/eventApi';

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function MetadataCell({ values }: { values: string[] }) {
  if (values.length === 0) return <span className="event-table__empty-value">—</span>;
  const visible = values.slice(0, 3);
  return (
    <span className="event-table__metadata">
      <span>{visible.join('、')}</span>
      {values.length > visible.length ? (
        <span className="metadata-more">+{values.length - visible.length}</span>
      ) : null}
    </span>
  );
}

export function EventListPage() {
  const [searchParameters, setSearchParameters] = useSearchParams();
  const query = searchParameters.get('q') ?? '';
  const [searchInput, setSearchInput] = useState(query);
  const [cursorStack, setCursorStack] = useState<Array<string | undefined>>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const cursor = cursorStack[pageIndex];

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const normalized = searchInput.trim();
      setSearchParameters(normalized ? { q: normalized } : {}, { replace: true });
      setCursorStack([undefined]);
      setPageIndex(0);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchInput, setSearchParameters]);

  const events = useQuery({
    queryKey: ['events', 'list', query, cursor ?? null],
    queryFn: ({ signal }) => getEvents({ q: query, ...(cursor ? { cursor } : {}) }, signal),
  });

  function nextPage(): void {
    if (!events.data?.nextCursor) return;
    const nextCursor = events.data.nextCursor;
    setCursorStack((current) => [...current.slice(0, pageIndex + 1), nextCursor]);
    setPageIndex((current) => current + 1);
  }

  function previousPage(): void {
    setPageIndex((current) => Math.max(0, current - 1));
  }

  return (
    <section className="event-list-page" aria-labelledby="event-list-title">
      <div className="page-heading">
        <div>
          <h1 id="event-list-title">原子事件</h1>
          <p>管理因果网络中可复用的原子事件</p>
        </div>
        <Link className="button button--primary" to="/events/new">
          创建事件
        </Link>
      </div>

      <div className="event-search">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4 4" />
        </svg>
        <input
          aria-label="搜索事件"
          type="search"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="搜索名称、别名或关键词"
        />
      </div>

      {events.isPending ? <div className="table-state">加载事件…</div> : null}
      {events.isError ? (
        <div className="table-state table-state--error" role="alert">
          <strong>无法加载事件</strong>
          <span>请确认服务连接后重试。</span>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => void events.refetch()}
          >
            重新加载
          </button>
        </div>
      ) : null}
      {events.isSuccess && events.data.items.length === 0 ? (
        <div className="table-state table-state--empty">
          <strong>{query ? '没有找到事件' : '还没有原子事件'}</strong>
          <span>{query ? '尝试更换搜索词。' : '创建第一个事件，开始构建因果知识。'}</span>
          <Link className="button button--secondary" to="/events/new">
            创建事件
          </Link>
        </div>
      ) : null}
      {events.isSuccess && events.data.items.length > 0 ? (
        <>
          <div className="event-table-wrap">
            <table className="event-table">
              <thead>
                <tr>
                  <th scope="col">标准名称</th>
                  <th scope="col">别名</th>
                  <th scope="col">关键词</th>
                  <th scope="col">更新时间</th>
                </tr>
              </thead>
              <tbody>
                {events.data.items.map((event) => (
                  <tr key={event.id}>
                    <td>
                      <Link to={`/events/${event.id}`}>{event.name}</Link>
                    </td>
                    <td>
                      <MetadataCell values={event.aliases} />
                    </td>
                    <td>
                      <MetadataCell values={event.keywords} />
                    </td>
                    <td>
                      <time dateTime={event.updatedAt}>
                        {dateFormatter.format(new Date(event.updatedAt))}
                      </time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav className="pagination" aria-label="事件分页">
            <button
              className="button button--secondary"
              type="button"
              onClick={previousPage}
              disabled={pageIndex === 0}
            >
              上一页
            </button>
            <button
              className="button button--primary"
              type="button"
              onClick={nextPage}
              disabled={!events.data.hasMore || !events.data.nextCursor}
            >
              下一页
            </button>
          </nav>
        </>
      ) : null}
    </section>
  );
}
