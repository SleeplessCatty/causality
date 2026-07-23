import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';

import { scrollMainContentToTop } from '../../../app/scrollMainContentToTop';
import { DeleteRecordDialog } from '../../../shared/deletion/DeleteRecordDialog';
import { usePermanentDeletion } from '../../../shared/deletion/usePermanentDeletion';
import { createListReturnState } from '../../../shared/navigation/listReturn';
import { listRecordDomId, useListRecordFocus } from '../../../shared/navigation/useListRecordFocus';
import { OverflowText } from '../../../shared/tooltip/OverflowText';
import { ListPagination, readListPage } from '../../../shared/pagination/ListPagination';
import { deleteEvent, getEventDeletionImpact, getEvents } from '../api/eventApi';

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function MetadataCell({ values }: { values: string[] }) {
  if (values.length === 0) return <span className="event-table__empty-value">—</span>;
  const visible = values.slice(0, 3);
  return (
    <OverflowText content={values.join('、')} mode="always">
      <span className="event-table__metadata">
        <span>{visible.join('、')}</span>
        {values.length > visible.length ? (
          <span className="metadata-more">+{values.length - visible.length}</span>
        ) : null}
      </span>
    </OverflowText>
  );
}

export function EventListPage() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const [searchParameters, setSearchParameters] = useSearchParams();
  const query = searchParameters.get('q') ?? '';
  const orphan = searchParameters.get('orphan') === 'true';
  const hasActiveFilter = Boolean(query) || orphan;
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

  const events = useQuery({
    queryKey: ['events', 'list', query, orphan, page],
    queryFn: ({ signal }) => getEvents({ q: query, page, orphan }, signal),
    placeholderData: (previous) => previous,
  });
  const deletion = usePermanentDeletion({
    getImpact: getEventDeletionImpact,
    deleteRecord: deleteEvent,
    notFoundCode: 'EVENT_NOT_FOUND',
    afterDelete: async () => {
      await queryClient.invalidateQueries({ queryKey: ['events', 'list'] });
    },
    recoverImpact: (error) =>
      error.details.code === 'EVENT_DELETE_BLOCKED'
        ? { canDelete: false, hasRelations: true }
        : null,
  });
  useListRecordFocus(events.data?.items.map((event) => event.id) ?? []);

  useEffect(() => {
    if (!events.data || events.isPlaceholderData || events.data.page === page) return;
    setSearchParameters(
      (current) => {
        const next = new URLSearchParams(current);
        next.set('page', String(events.data!.page));
        return next;
      },
      { replace: true },
    );
  }, [events.data, events.isPlaceholderData, page, setSearchParameters]);

  function changePage(nextPage: number): void {
    setSearchParameters((current) => {
      const next = new URLSearchParams(current);
      next.set('page', String(nextPage));
      return next;
    });
  }

  return (
    <section className="event-list-page" aria-labelledby="event-list-title">
      <div className="page-heading">
        <div>
          <h1 id="event-list-title">原子事件</h1>
          <p>管理因果网络中可复用的原子事件</p>
        </div>
        <Link
          className="button button--primary"
          to="/events/new"
          state={createListReturnState(location)}
        >
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

      {deletion.pageError ? (
        <div className="form-alert list-action-error" role="alert">
          {deletion.pageError}
        </div>
      ) : null}
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
          <strong>{hasActiveFilter ? '没有找到事件' : '还没有原子事件'}</strong>
          <span>
            {hasActiveFilter ? '尝试调整筛选条件。' : '创建第一个事件，开始构建因果知识。'}
          </span>
          <Link
            className="button button--secondary"
            to="/events/new"
            state={createListReturnState(location)}
          >
            创建事件
          </Link>
        </div>
      ) : null}
      {events.isSuccess && events.data.items.length > 0 ? (
        <div className="event-table-wrap">
          <table className="event-table">
            <thead>
              <tr>
                <th scope="col">标准名称</th>
                <th scope="col">别名</th>
                <th scope="col">关键词</th>
                <th scope="col">关联关系数</th>
                <th scope="col">更新时间</th>
                <th scope="col">
                  <span className="sr-only">操作</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {events.data.items.map((event) => (
                <tr key={event.id} id={listRecordDomId(event.id)}>
                  <td>
                    <OverflowText content={event.name}>
                      <Link
                        to={`/events/${event.id}`}
                        state={createListReturnState(location, event.id)}
                      >
                        {event.name}
                      </Link>
                    </OverflowText>
                  </td>
                  <td>
                    <MetadataCell values={event.aliases} />
                  </td>
                  <td>
                    <MetadataCell values={event.keywords} />
                  </td>
                  <td>{event.relationCount}</td>
                  <td>
                    <time dateTime={event.updatedAt}>
                      {dateFormatter.format(new Date(event.updatedAt))}
                    </time>
                  </td>
                  <td className="event-row-actions">
                    <Link
                      className="text-button"
                      to={`/events/${event.id}/edit`}
                      state={createListReturnState(location, event.id)}
                    >
                      编辑
                    </Link>
                    <button
                      className="text-button text-button--danger"
                      type="button"
                      disabled={deletion.loadingId === event.id}
                      onClick={() => void deletion.requestDelete(event.id)}
                    >
                      {deletion.loadingId === event.id ? '检查中…' : '删除'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {events.isSuccess ? (
        <ListPagination
          page={events.data.page}
          totalPages={events.data.totalPages}
          totalItems={events.data.totalItems}
          disabled={events.isFetching}
          onPageChange={changePage}
          onNavigate={scrollMainContentToTop}
        />
      ) : null}
      <DeleteRecordDialog
        open={Boolean(deletion.targetId && deletion.impact)}
        title="删除原子事件"
        message={
          deletion.impact?.hasRelations
            ? '这个原子事件存在关联因果关系，必须先删除相关因果关系。'
            : '确认永久删除这个原子事件？此操作无法恢复。'
        }
        blocked={Boolean(deletion.impact?.hasRelations)}
        pending={deletion.pending}
        error={deletion.dialogError}
        onCancel={deletion.close}
        onConfirm={() => void deletion.confirmDelete()}
        {...(deletion.targetId && deletion.impact?.hasRelations
          ? {
              blockedAction: {
                label: '查看相关因果关系',
                href: `/relations?eventId=${deletion.targetId}`,
              },
            }
          : {})}
      />
    </section>
  );
}
