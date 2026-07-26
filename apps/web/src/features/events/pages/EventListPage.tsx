import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router';

import { scrollMainContentToTop } from '../../../app/scrollMainContentToTop';
import { DeleteRecordDialog } from '../../../shared/deletion/DeleteRecordDialog';
import { usePermanentDeletion } from '../../../shared/deletion/usePermanentDeletion';
import { ListSearchControls } from '../../../shared/lists/ListSearchControls';
import { useListPageCorrection, useListQueryState } from '../../../shared/lists/useListQueryState';
import { createListReturnState } from '../../../shared/navigation/listReturn';
import { listRecordDomId, useListRecordFocus } from '../../../shared/navigation/useListRecordFocus';
import { OverflowText } from '../../../shared/tooltip/OverflowText';
import { ListPagination } from '../../../shared/pagination/ListPagination';
import {
  isSemanticSearchError,
  useEnhancedListSearch,
  useEnhancedListSearchResult,
} from '../../../shared/search/useEnhancedListSearch';
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
  const listState = useListQueryState();
  const { searchParameters, setSearchParameters, query, page } = listState;
  const orphan = searchParameters.get('orphan') === 'true';
  const hasActiveFilter = Boolean(query) || orphan;
  const enhancedSearch = useEnhancedListSearch({
    normalizedQuery: query,
    ...listState.enhancedSearchController,
  });

  const events = useQuery({
    queryKey: [
      'events',
      'list',
      query,
      orphan,
      page,
      enhancedSearch.mode,
      enhancedSearch.mode === 'enhanced' ? enhancedSearch.requestId : 0,
    ],
    queryFn: ({ signal }) =>
      getEvents({ q: query, page, orphan, searchMode: enhancedSearch.mode }, signal),
    placeholderData: (previous) => previous,
  });
  const semanticQueryError = isSemanticSearchError(events.error);
  const eventData = events.data;
  useEnhancedListSearchResult(enhancedSearch, events);
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
  useListPageCorrection({
    requestedPage: page,
    responsePage: events.data?.page,
    isPlaceholderData: events.isPlaceholderData,
    setSearchParameters,
  });

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

      <ListSearchControls
        label="搜索事件"
        placeholder="搜索名称、别名或关键词"
        value={listState.searchInput}
        isEnhancing={enhancedSearch.isEnhancing}
        notice={enhancedSearch.notice}
        onChange={listState.setSearchInput}
        onEnhance={enhancedSearch.requestEnhanced}
      />

      {deletion.pageError ? (
        <div className="form-alert list-action-error" role="alert">
          {deletion.pageError}
        </div>
      ) : null}
      {events.isPending && !eventData ? <div className="table-state">加载事件…</div> : null}
      {events.isError && !semanticQueryError ? (
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
      {eventData && eventData.items.length === 0 ? (
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
      {eventData && eventData.items.length > 0 ? (
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
              {eventData.items.map((event) => (
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
      {eventData ? (
        <ListPagination
          page={eventData.page}
          totalPages={eventData.totalPages}
          totalItems={eventData.totalItems}
          disabled={events.isFetching}
          onPageChange={listState.changePage}
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
