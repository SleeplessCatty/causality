import { useQuery } from '@tanstack/react-query';
import { Fragment, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { getRelation, getRelations } from '../api/relationApi';

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function RelationListPage() {
  const [searchParameters, setSearchParameters] = useSearchParams();
  const query = searchParameters.get('q') ?? '';
  const expandedId = searchParameters.get('expanded') ?? '';
  const [searchInput, setSearchInput] = useState(query);
  const [cursorStack, setCursorStack] = useState<Array<string | undefined>>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const cursor = cursorStack[pageIndex];

  useEffect(() => {
    setSearchInput(query);
  }, [query]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const normalized = searchInput.trim();
      if (normalized === query) return;
      setSearchParameters(
        (current) => {
          const next = new URLSearchParams(current);
          if (normalized) next.set('q', normalized);
          else next.delete('q');
          next.delete('expanded');
          return next;
        },
        { replace: true },
      );
      setCursorStack([undefined]);
      setPageIndex(0);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [query, searchInput, setSearchParameters]);

  const relations = useQuery({
    queryKey: ['relations', 'list', query, cursor ?? null],
    queryFn: ({ signal }) => getRelations({ q: query, ...(cursor ? { cursor } : {}) }, signal),
  });
  const expanded = useQuery({
    queryKey: ['relations', 'detail', expandedId],
    queryFn: ({ signal }) => getRelation(expandedId, signal),
    enabled: Boolean(expandedId),
  });

  const items = relations.data?.items ?? [];
  const visibleItems =
    expanded.data && !items.some((item) => item.id === expanded.data.id)
      ? [expanded.data, ...items]
      : items;

  function toggleDetail(id: string): void {
    setSearchParameters(
      (current) => {
        const next = new URLSearchParams(current);
        if (next.get('expanded') === id) next.delete('expanded');
        else next.set('expanded', id);
        return next;
      },
      { replace: true },
    );
  }

  function nextPage(): void {
    if (!relations.data?.nextCursor) return;
    clearExpanded();
    setCursorStack((current) => [...current.slice(0, pageIndex + 1), relations.data!.nextCursor!]);
    setPageIndex((current) => current + 1);
  }

  function previousPage(): void {
    if (pageIndex === 0) return;
    clearExpanded();
    setPageIndex((current) => Math.max(0, current - 1));
  }

  function clearExpanded(): void {
    setSearchParameters(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('expanded');
        return next;
      },
      { replace: true },
    );
  }

  return (
    <section className="relation-list-page" aria-labelledby="relation-list-title">
      <div className="page-heading">
        <div>
          <h1 id="relation-list-title">因果关系</h1>
          <p>维护原子事件之间有方向的因果关联</p>
        </div>
        <Link className="button button--primary" to="/relations/new">
          创建关系
        </Link>
      </div>

      <div className="event-search">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4 4" />
        </svg>
        <input
          aria-label="搜索因果关系"
          type="search"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="搜索原因事件、结果事件或关系说明"
        />
      </div>

      {relations.isPending ? <div className="table-state">加载因果关系…</div> : null}
      {relations.isError || expanded.isError ? (
        <div className="table-state table-state--error" role="alert">
          <strong>无法加载因果关系</strong>
          <span>请确认服务连接后重试。</span>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => void relations.refetch()}
          >
            重新加载
          </button>
        </div>
      ) : null}
      {relations.isSuccess && visibleItems.length === 0 && !expanded.isPending ? (
        <div className="table-state table-state--empty">
          <strong>{query ? '没有找到因果关系' : '还没有因果关系'}</strong>
          <span>{query ? '尝试更换搜索词。' : '创建第一条关系，连接已有的原子事件。'}</span>
          <Link className="button button--secondary" to="/relations/new">
            创建关系
          </Link>
        </div>
      ) : null}
      {visibleItems.length > 0 ? (
        <>
          <div className="event-table-wrap relation-table-wrap">
            <table className="event-table relation-table">
              <thead>
                <tr>
                  <th scope="col">原因事件</th>
                  <th scope="col" aria-label="方向" />
                  <th scope="col">结果事件</th>
                  <th scope="col">置信度</th>
                  <th scope="col">案例数</th>
                  <th scope="col">更新时间</th>
                  <th scope="col">
                    <span className="sr-only">操作</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((relation) => (
                  <Fragment key={relation.id}>
                    <tr
                      className={expandedId === relation.id ? 'relation-row--expanded' : undefined}
                    >
                      <td>
                        <Link
                          className="relation-entity-link"
                          to={`/events/${relation.causeEvent.id}`}
                        >
                          {relation.causeEvent.name}
                        </Link>
                      </td>
                      <td className="relation-direction" aria-label="导致">
                        <Link
                          className="relation-entity-link relation-direction__link"
                          to={`/relations/${relation.id}`}
                          aria-label="查看因果关系详情"
                        >
                          →
                        </Link>
                      </td>
                      <td>
                        <Link
                          className="relation-entity-link"
                          to={`/events/${relation.effectEvent.id}`}
                        >
                          {relation.effectEvent.name}
                        </Link>
                      </td>
                      <td>
                        <strong className="confidence-value">{relation.confidence}%</strong>
                      </td>
                      <td>{relation.caseCount}</td>
                      <td>
                        <time dateTime={relation.updatedAt}>
                          {dateFormatter.format(new Date(relation.updatedAt))}
                        </time>
                      </td>
                      <td className="relation-row-actions">
                        <button
                          className="text-button"
                          type="button"
                          aria-expanded={expandedId === relation.id}
                          onClick={() => toggleDetail(relation.id)}
                        >
                          {expandedId === relation.id ? '收起' : '展开'}
                        </button>
                        <Link className="text-button" to={`/relations/${relation.id}/edit`}>
                          编辑
                        </Link>
                      </td>
                    </tr>
                    {expandedId === relation.id ? (
                      <tr className="relation-detail-row">
                        <td colSpan={7}>
                          {expanded.isPending ? <span>加载详情…</span> : null}
                          {expanded.data ? (
                            <div className="relation-inline-detail">
                              <div>
                                <span>关系说明</span>
                                <p>{expanded.data.description ?? '未填写'}</p>
                              </div>
                              <div className="relation-inline-cases">
                                <div className="relation-inline-cases__heading">
                                  <span>具体案例</span>
                                  <strong>{expanded.data.caseCount} 条</strong>
                                </div>
                                {expanded.data.recentCases.length > 0 ? (
                                  <ul>
                                    {expanded.data.recentCases.map((item) => (
                                      <li key={item.id}>
                                        <Link to={`/cases/${item.id}`}>{item.content}</Link>
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p>尚未关联具体案例</p>
                                )}
                                {expanded.data.caseCount > 5 ? (
                                  <Link
                                    className="relation-inline-cases__all"
                                    to={`/cases?relationId=${expanded.data.id}`}
                                  >
                                    查看全部 {expanded.data.caseCount} 条
                                  </Link>
                                ) : null}
                              </div>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <nav className="pagination" aria-label="因果关系分页">
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
              disabled={!relations.data?.hasMore || !relations.data.nextCursor}
            >
              下一页
            </button>
          </nav>
        </>
      ) : null}
    </section>
  );
}
