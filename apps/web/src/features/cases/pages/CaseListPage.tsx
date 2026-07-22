import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { OverflowText } from '../../../shared/tooltip/OverflowText';
import { ListPagination, readListPage } from '../../../shared/pagination/ListPagination';
import { getCases } from '../api/caseApi';

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function CaseListPage() {
  const [searchParameters, setSearchParameters] = useSearchParams();
  const query = searchParameters.get('q') ?? '';
  const relationId = searchParameters.get('relationId') ?? '';
  const page = readListPage(searchParameters.get('page'));
  const [searchInput, setSearchInput] = useState(query);

  useEffect(() => setSearchInput(query), [query]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const normalized = searchInput.trim();
      if (normalized === query) return;
      setSearchParameters(
        (current) => {
          const next = new URLSearchParams(current);
          if (normalized) next.set('q', normalized);
          else next.delete('q');
          next.delete('page');
          return next;
        },
        { replace: true },
      );
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [query, searchInput, setSearchParameters]);

  const cases = useQuery({
    queryKey: ['cases', 'list', query, relationId || null, page],
    queryFn: ({ signal }) =>
      getCases(
        {
          q: query,
          page,
          limit: 30,
          ...(relationId ? { relationId } : {}),
        },
        signal,
      ),
    placeholderData: (previous) => previous,
  });

  useEffect(() => {
    if (!cases.data || cases.isPlaceholderData || cases.data.page === page) return;
    setSearchParameters(
      (current) => {
        const next = new URLSearchParams(current);
        next.set('page', String(cases.data!.page));
        return next;
      },
      { replace: true },
    );
  }, [cases.data, cases.isPlaceholderData, page, setSearchParameters]);

  function clearRelationFilter(): void {
    const next = new URLSearchParams();
    if (query) next.set('q', query);
    setSearchParameters(next);
  }

  function changePage(nextPage: number): void {
    setSearchParameters((current) => {
      const next = new URLSearchParams(current);
      next.set('page', String(nextPage));
      return next;
    });
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
      ) : null}
      {cases.isSuccess ? (
        <ListPagination
          page={cases.data.page}
          totalPages={cases.data.totalPages}
          totalItems={cases.data.totalItems}
          disabled={cases.isFetching}
          onPageChange={changePage}
        />
      ) : null}
    </section>
  );
}
