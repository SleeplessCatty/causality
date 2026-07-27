import type { ImportBatchSummary, ImportRecordItem, ImportRecordType } from '@causality/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router';

import { scrollMainContentToTop } from '../../../app/scrollMainContentToTop';
import { AppTabs } from '../../../shared/controls/AppTabs';
import { listFocusState, resolveListReturnPath } from '../../../shared/navigation/listReturn';
import { ListPagination, readListPage } from '../../../shared/pagination/ListPagination';
import { OverflowText } from '../../../shared/tooltip/OverflowText';
import { getImportBatch, getImportRecords } from '../dataTransferApi';

type DetailTab = 'events' | 'cases' | 'relations' | 'relationCases';

interface DetailTabConfig {
  value: DetailTab;
  label: string;
  recordType: ImportRecordType;
  pageParameter: string;
}

const detailTabs: readonly DetailTabConfig[] = [
  { value: 'events', label: '原子事件', recordType: 'event', pageParameter: 'eventPage' },
  { value: 'cases', label: '具体案例', recordType: 'case', pageParameter: 'casePage' },
  { value: 'relations', label: '因果关系', recordType: 'relation', pageParameter: 'relationPage' },
  {
    value: 'relationCases',
    label: '案例关联',
    recordType: 'relation_case',
    pageParameter: 'relationCasePage',
  },
];

const completedAtFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'long',
  timeStyle: 'short',
});

function isDetailTab(value: string | null): value is DetailTab {
  return detailTabs.some((tab) => tab.value === value);
}

function formatCounts(batch: ImportBatchSummary, type: ImportRecordType): string {
  const counts =
    type === 'event'
      ? batch.counts.event
      : type === 'case'
        ? batch.counts.case
        : type === 'relation'
          ? batch.counts.relation
          : batch.counts.relationCase;
  return `新增 ${counts.created} / 复用 ${counts.reused}`;
}

function formatRecordText(record: ImportRecordItem): string {
  switch (record.text.type) {
    case 'event':
      return record.text.eventName;
    case 'case':
      return record.text.caseContent;
    case 'relation':
      return `${record.text.causeEventName} → ${record.text.effectEventName}`;
    case 'relation_case':
      return `${record.text.causeEventName} → ${record.text.effectEventName} + ${record.text.caseContent}`;
  }
}

export function ImportDetailPage() {
  const { batchId = '' } = useParams();
  const location = useLocation();
  const [searchParameters, setSearchParameters] = useSearchParams();
  const activeTabValue = isDetailTab(searchParameters.get('tab'))
    ? searchParameters.get('tab')
    : 'events';
  const activeTab = detailTabs.find((tab) => tab.value === activeTabValue) ?? detailTabs[0]!;
  const pages = useMemo(
    () => ({
      eventPage: readListPage(searchParameters.get('eventPage')),
      casePage: readListPage(searchParameters.get('casePage')),
      relationPage: readListPage(searchParameters.get('relationPage')),
      relationCasePage: readListPage(searchParameters.get('relationCasePage')),
    }),
    [searchParameters],
  );
  const activePage = pages[activeTab.pageParameter as keyof typeof pages];

  useEffect(() => {
    const next = new URLSearchParams(searchParameters);
    let changed = false;
    if (next.get('tab') !== activeTab.value) {
      next.set('tab', activeTab.value);
      changed = true;
    }
    for (const tab of detailTabs) {
      const normalizedPage = pages[tab.pageParameter as keyof typeof pages];
      if (next.get(tab.pageParameter) !== String(normalizedPage)) {
        next.set(tab.pageParameter, String(normalizedPage));
        changed = true;
      }
    }
    if (changed) setSearchParameters(next, { replace: true, state: location.state });
  }, [activeTab.value, location.state, pages, searchParameters, setSearchParameters]);

  const batch = useQuery({
    queryKey: ['data-transfers', 'imports', batchId],
    queryFn: ({ signal }) => getImportBatch(batchId, signal),
    enabled: Boolean(batchId),
  });
  const records = useQuery({
    queryKey: ['data-transfers', 'imports', batchId, activeTab.recordType, activePage],
    queryFn: async ({ signal }) => ({
      requestedPage: activePage,
      response: await getImportRecords(batchId, activeTab.recordType, activePage, signal),
    }),
    enabled: Boolean(batchId),
    placeholderData: (previous) => previous,
  });
  const recordData = records.data?.response;

  useEffect(() => {
    if (
      records.isFetching ||
      records.isPlaceholderData ||
      records.data?.requestedPage !== activePage ||
      recordData?.page === undefined ||
      recordData.page === activePage
    ) {
      return;
    }
    const next = new URLSearchParams(searchParameters);
    next.set(activeTab.pageParameter, String(recordData.page));
    setSearchParameters(next, { replace: true, state: location.state });
  }, [
    activePage,
    activeTab.pageParameter,
    location.state,
    recordData?.page,
    records.data?.requestedPage,
    records.isFetching,
    records.isPlaceholderData,
    searchParameters,
    setSearchParameters,
  ]);

  const returnPath = resolveListReturnPath(location.state, '/data-transfer', 1);

  if (batch.isPending) return <div className="page-state">加载导入详情…</div>;
  if (batch.isError) {
    return (
      <div className="page-state page-state--error" role="alert">
        <strong>无法读取导入详情</strong>
        <Link className="button button--secondary" to={returnPath} state={listFocusState(batchId)}>
          返回导入历史
        </Link>
      </div>
    );
  }

  return (
    <section className="data-transfer-detail-page" aria-labelledby="import-detail-title">
      <Link className="back-link" to={returnPath} state={listFocusState(batchId)}>
        <svg aria-hidden="true" viewBox="0 0 20 20">
          <path d="m12.5 4.5-5.5 5.5 5.5 5.5" />
        </svg>
        返回导入历史
      </Link>
      <div className="detail-heading data-transfer-detail-heading">
        <div>
          <span className="detail-label">导入记录</span>
          <OverflowText content={batch.data.filename} lines={2} mode="always">
            <h1 id="import-detail-title">{batch.data.filename}</h1>
          </OverflowText>
        </div>
      </div>

      <dl className="data-transfer-summary-grid">
        <div>
          <dt>完成时间</dt>
          <dd>{completedAtFormatter.format(new Date(batch.data.completedAt))}</dd>
        </div>
        {detailTabs.map((tab) => (
          <div key={tab.value}>
            <dt>{tab.label}</dt>
            <dd>{formatCounts(batch.data, tab.recordType)}</dd>
          </div>
        ))}
      </dl>

      <div className="data-transfer-detail-records">
        <AppTabs
          id="import-record-type"
          label="导入明细类型"
          value={activeTab.value}
          tabs={detailTabs}
          onChange={(value) => {
            const next = new URLSearchParams(searchParameters);
            next.set('tab', value);
            setSearchParameters(next, { state: location.state });
          }}
        >
          {records.isPending && !recordData ? (
            <div className="table-state">加载导入明细…</div>
          ) : null}
          {records.isError ? (
            <div className="table-state table-state--error" role="alert">
              <strong>无法加载导入明细</strong>
              <button
                className="button button--secondary"
                type="button"
                onClick={() => void records.refetch()}
              >
                重新加载
              </button>
            </div>
          ) : null}
          {recordData?.items.length === 0 ? (
            <div className="table-state table-state--empty">
              <strong>没有这类导入明细</strong>
            </div>
          ) : null}
          {recordData && recordData.items.length > 0 ? (
            <div className="event-table-wrap data-transfer-table-wrap">
              <table className="event-table data-transfer-record-table">
                <thead>
                  <tr>
                    <th scope="col">顺序</th>
                    <th scope="col">处理结果</th>
                    <th scope="col">内容</th>
                  </tr>
                </thead>
                <tbody>
                  {recordData.items.map((record) => {
                    const content = formatRecordText(record);
                    return (
                      <tr key={record.id}>
                        <td>{record.sequence}</td>
                        <td>
                          <span
                            className={`data-transfer-outcome data-transfer-outcome--${record.outcome}`}
                          >
                            {record.outcome === 'created' ? '新增' : '复用'}
                          </span>
                        </td>
                        <td>
                          <OverflowText content={content} mode="always">
                            <span>{content}</span>
                          </OverflowText>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
          {recordData ? (
            <ListPagination
              page={recordData.page}
              totalPages={recordData.totalPages}
              totalItems={recordData.totalItems}
              disabled={records.isFetching}
              onPageChange={(page) => {
                const next = new URLSearchParams(searchParameters);
                next.set(activeTab.pageParameter, String(page));
                setSearchParameters(next, { state: location.state });
              }}
              onNavigate={scrollMainContentToTop}
            />
          ) : null}
        </AppTabs>
      </div>
    </section>
  );
}
