import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { OverflowText } from '../../../shared/tooltip/OverflowText';
import { getCases } from '../api/caseApi';

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function CaseListPage() {
  const [searchParameters, setSearchParameters] = useSearchParams();
  const query = searchParameters.get('q') ?? '';
  const relationId = searchParameters.get('relationId') ?? '';
  const [searchInput, setSearchInput] = useState(query);
  const [cursorStack, setCursorStack] = useState<Array<string | undefined>>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const cursor = cursorStack[pageIndex];

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const normalized = searchInput.trim();
      const next = new URLSearchParams();
      if (normalized) next.set('q', normalized);
      if (relationId) next.set('relationId', relationId);
      setSearchParameters(next, { replace: true });
      setCursorStack([undefined]);
      setPageIndex(0);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [relationId, searchInput, setSearchParameters]);

  const cases = useQuery({
    queryKey: ['cases', 'list', query, relationId || null, cursor ?? null],
    queryFn: ({ signal }) =>
      getCases(
        {
          q: query,
          ...(relationId ? { relationId } : {}),
          ...(cursor ? { cursor } : {}),
        },
        signal,
      ),
  });

  function clearRelationFilter(): void {
    const next = new URLSearchParams();
    if (query) next.set('q', query);
    setSearchParameters(next);
    setCursorStack([undefined]);
    setPageIndex(0);
  }

  return (
    <section className="event-list-page" aria-labelledby="case-list-title">
      <div className="page-heading">
        <div>
          <h1 id="case-list-title">具体案例</h1>
          <p>记录真实发生的事件，并将其作为抽象因果关系的验证依据</p>
        </div>
        <Link className="button button--primary" to="/cases/new">
          创建案例
        </Link>
      </div>

      {relationId ? (
        <div className="case-filter-notice">
          <span>当前仅显示指定因果关系关联的案例</span>
          <button className="text-button" type="button" onClick={clearRelationFilter}>
            清除筛选
          </button>
        </div>
      ) : null}

      <div className="event-search">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4 4" />
        </svg>
        <input
          aria-label="搜索案例"
          type="search"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="搜索案例内容"
        />
      </div>

      {cases.isPending ? <div className="table-state">加载案例…</div> : null}
      {cases.isError ? (
        <div className="table-state table-state--error" role="alert">
          <strong>无法加载案例</strong>
          <span>请确认服务连接后重试。</span>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => void cases.refetch()}
          >
            重新加载
          </button>
        </div>
      ) : null}
      {cases.isSuccess && cases.data.items.length === 0 ? (
        <div className="table-state table-state--empty">
          <strong>{query || relationId ? '没有找到案例' : '还没有具体案例'}</strong>
          <span>{query || relationId ? '尝试调整筛选条件。' : '创建第一条真实事件记录。'}</span>
          {!relationId ? (
            <Link className="button button--secondary" to="/cases/new">
              创建案例
            </Link>
          ) : null}
        </div>
      ) : null}
      {cases.isSuccess && cases.data.items.length > 0 ? (
        <>
          <div className="event-table-wrap">
            <table className="event-table case-table">
              <thead>
                <tr>
                  <th scope="col">案例内容</th>
                  <th scope="col">关联关系数</th>
                  <th scope="col">更新时间</th>
                  <th scope="col">
                    <span className="sr-only">操作</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {cases.data.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <OverflowText content={item.content}>
                        <Link to={`/cases/${item.id}`}>{item.content}</Link>
                      </OverflowText>
                    </td>
                    <td>{item.relationCount}</td>
                    <td>
                      <time dateTime={item.updatedAt}>
                        {dateFormatter.format(new Date(item.updatedAt))}
                      </time>
                    </td>
                    <td>
                      <Link className="table-action-link" to={`/cases/${item.id}/edit`}>
                        编辑
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav className="pagination" aria-label="案例分页">
            <button
              className="button button--secondary"
              type="button"
              onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
              disabled={pageIndex === 0}
            >
              上一页
            </button>
            <button
              className="button button--primary"
              type="button"
              onClick={() => {
                if (!cases.data.nextCursor) return;
                setCursorStack((current) => [
                  ...current.slice(0, pageIndex + 1),
                  cases.data.nextCursor ?? undefined,
                ]);
                setPageIndex((current) => current + 1);
              }}
              disabled={!cases.data.hasMore || !cases.data.nextCursor}
            >
              下一页
            </button>
          </nav>
        </>
      ) : null}
    </section>
  );
}
