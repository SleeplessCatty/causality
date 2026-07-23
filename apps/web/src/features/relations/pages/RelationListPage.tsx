import { useQuery } from '@tanstack/react-query';
import { Fragment, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { OverflowText } from '../../../shared/tooltip/OverflowText';
import { ListPagination, readListPage } from '../../../shared/pagination/ListPagination';
import { getRelation, getRelations } from '../api/relationApi';

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function RelationListPage() {
  const [searchParameters, setSearchParameters] = useSearchParams();
  const query = searchParameters.get('q') ?? '';
  const expandedId = searchParameters.get('expanded') ?? '';
  const page = readListPage(searchParameters.get('page'));
  const [searchInput, setSearchInput] = useState(query);

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
          next.delete('page');
          return next;
        },
        { replace: true },
      );
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [query, searchInput, setSearchParameters]);

  const relations = useQuery({
    queryKey: ['relations', 'list', query, page],
    queryFn: ({ signal }) => getRelations({ q: query, page, limit: 50 }, signal),
    placeholderData: (previous) => previous,
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

  useEffect(() => {
    if (!relations.data || relations.isPlaceholderData || relations.data.page === page) return;
    setSearchParameters(
      (current) => {
        const next = new URLSearchParams(current);
        next.set('page', String(relations.data!.page));
        return next;
      },
      { replace: true },
    );
  }, [page, relations.data, relations.isPlaceholderData, setSearchParameters]);

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

  function changePage(nextPage: number): void {
    setSearchParameters((current) => {
      const next = new URLSearchParams(current);
      next.delete('expanded');
      next.set('page', String(nextPage));
      return next;
    });
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
      {relations.isSuccess && visibleItems.length === 0 && !expandedId ? (
        <div className="table-state table-state--empty">
          <strong>{query ? '没有找到因果关系' : '还没有因果关系'}</strong>
          <span>{query ? '尝试更换搜索词。' : '创建第一条关系，连接已有的原子事件。'}</span>
          <Link className="button button--secondary" to="/relations/new">
            创建关系
          </Link>
        </div>
      ) : null}
      {visibleItems.length > 0 ? (
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
                  <tr className={expandedId === relation.id ? 'relation-row--expanded' : undefined}>
                    <td>
                      <OverflowText content={relation.causeEvent.name}>
                        <Link
                          className="relation-entity-link"
                          to={`/events/${relation.causeEvent.id}`}
                        >
                          {relation.causeEvent.name}
                        </Link>
                      </OverflowText>
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
                      <OverflowText content={relation.effectEvent.name}>
                        <Link
                          className="relation-entity-link"
                          to={`/events/${relation.effectEvent.id}`}
                        >
                          {relation.effectEvent.name}
                        </Link>
                      </OverflowText>
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
                              {expanded.data.description ? (
                                <OverflowText content={expanded.data.description} lines={2}>
                                  <p>{expanded.data.description}</p>
                                </OverflowText>
                              ) : (
                                <p>未填写</p>
                              )}
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
                                      <OverflowText content={item.content} lines={2}>
                                        <Link to={`/cases/${item.id}`}>{item.content}</Link>
                                      </OverflowText>
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
      ) : null}
      {relations.isSuccess ? (
        <ListPagination
          page={relations.data.page}
          totalPages={relations.data.totalPages}
          totalItems={relations.data.totalItems}
          disabled={relations.isFetching}
          onPageChange={changePage}
        />
      ) : null}
    </section>
  );
}
