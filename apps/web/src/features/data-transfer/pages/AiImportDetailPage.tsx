import type {
  AiImportBatchDetail,
  AiImportRecordListResponse,
  AiImportRecordType,
} from '@causality/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router';

import { scrollMainContentToTop } from '../../../app/scrollMainContentToTop';
import { AppTabs } from '../../../shared/controls/AppTabs';
import { listFocusState, resolveListReturnPath } from '../../../shared/navigation/listReturn';
import { ListPagination, readListPage } from '../../../shared/pagination/ListPagination';
import { OverflowText } from '../../../shared/tooltip/OverflowText';
import { getAiImportBatch, getAiImportRecords } from '../dataTransferApi';

type DetailTab = 'events' | 'cases' | 'relations' | 'relationCases' | 'confidence';
type AiImportRecord = AiImportRecordListResponse['items'][number];

interface DetailTabConfig {
  value: DetailTab;
  label: string;
  recordType: AiImportRecordType;
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
  {
    value: 'confidence',
    label: '置信度变化',
    recordType: 'confidence',
    pageParameter: 'confidencePage',
  },
];

const completedAtFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'long',
  timeStyle: 'short',
});

const actionLabels: Record<AiImportRecord['action'], string> = {
  created: '新增',
  reused: '复用',
  updated: '更新',
  changed: '变更',
};

function isDetailTab(value: string | null): value is DetailTab {
  return detailTabs.some((tab) => tab.value === value);
}

function detailString(detail: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = detail[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function detailNumber(detail: Record<string, unknown>, key: string): number | undefined {
  const value = detail[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function detailStringArray(detail: Record<string, unknown>, key: string): string[] {
  const value = detail[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function formatEventRecord(record: AiImportRecord): string {
  const { detail } = record;
  const name = detailString(detail, 'name');
  if (name) return name;

  const parts: string[] = [];
  const aliases = detailStringArray(detail, 'appendAliases');
  const keywords = detailStringArray(detail, 'appendKeywords');
  const newDescription = detailString(detail, 'newDescription', 'description');
  if (aliases.length > 0) parts.push(`新增别名：${aliases.join('、')}`);
  if (keywords.length > 0) parts.push(`新增关键词：${keywords.join('、')}`);
  if (newDescription) parts.push(`说明：${newDescription}`);
  return parts.join('；') || detailString(detail, 'ref') || record.primaryRecordId;
}

function formatRecordText(record: AiImportRecord): string {
  const { detail } = record;
  switch (record.recordType) {
    case 'event':
      return formatEventRecord(record);
    case 'case':
      return detailString(detail, 'content') ?? record.primaryRecordId;
    case 'relation': {
      const cause =
        detailString(detail, 'causeEventName', 'causeEventId', 'cause_event_id') ?? '未知原因事件';
      const effect =
        detailString(detail, 'effectEventName', 'effectEventId', 'effect_event_id') ??
        '未知结果事件';
      const description = detailString(detail, 'description');
      return description ? `${cause} → ${effect}；${description}` : `${cause} → ${effect}`;
    }
    case 'relation_case': {
      const relation = detailString(detail, 'relationRef') ?? record.primaryRecordId;
      const concreteCase =
        detailString(detail, 'caseRef') ?? record.relatedRecordId ?? '未知具体案例';
      return `${relation} + ${concreteCase}`;
    }
    case 'confidence': {
      const relation = detailString(detail, 'relationRef') ?? record.primaryRecordId;
      const oldConfidence = detailNumber(detail, 'oldConfidence');
      const newConfidence = detailNumber(detail, 'newConfidence');
      const oldCaseCount = detailNumber(detail, 'oldCaseCount');
      const newCaseCount = detailNumber(detail, 'newCaseCount');
      const confidence =
        oldConfidence === undefined || newConfidence === undefined
          ? '置信度已变化'
          : `${oldConfidence}% → ${newConfidence}%`;
      const cases =
        oldCaseCount === undefined || newCaseCount === undefined
          ? ''
          : `（案例 ${oldCaseCount} → ${newCaseCount}）`;
      return `${relation}：${confidence}${cases}`;
    }
  }
}

function hasBusinessChanges(batch: AiImportBatchDetail): boolean {
  const counts = batch.counts;
  return (
    counts.eventCreated > 0 ||
    counts.eventUpdated > 0 ||
    counts.caseCreated > 0 ||
    counts.relationCreated > 0 ||
    counts.relationCaseCreated > 0 ||
    counts.confidenceChanged > 0
  );
}

export function AiImportDetailPage() {
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
      confidencePage: readListPage(searchParameters.get('confidencePage')),
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
    queryKey: ['ai-captures', 'history', batchId],
    queryFn: ({ signal }) => getAiImportBatch(batchId, signal),
    enabled: Boolean(batchId),
  });
  const records = useQuery({
    queryKey: ['ai-captures', 'history', batchId, activeTab.recordType, activePage],
    queryFn: async ({ signal }) => ({
      requestedPage: activePage,
      response: await getAiImportRecords(batchId, activeTab.recordType, activePage, signal),
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

  const resolvedReturnPath = resolveListReturnPath(location.state, '/data-transfer', 1);
  const returnPath =
    resolvedReturnPath === '/data-transfer'
      ? '/data-transfer?tab=aiHistory&page=1'
      : resolvedReturnPath;

  if (batch.isPending) return <div className="page-state">加载 AI 导入详情…</div>;
  if (batch.isError) {
    return (
      <div className="page-state page-state--error" role="alert">
        <strong>无法读取 AI 导入详情</strong>
        <Link className="button button--secondary" to={returnPath} state={listFocusState(batchId)}>
          返回 AI 导入历史
        </Link>
      </div>
    );
  }

  const counts = batch.data.counts;
  return (
    <section
      className="event-detail-page data-transfer-detail-page"
      aria-labelledby="ai-import-detail-title"
    >
      <Link className="back-link" to={returnPath} state={listFocusState(batchId)}>
        <svg aria-hidden="true" viewBox="0 0 20 20">
          <path d="m12.5 4.5-5.5 5.5 5.5 5.5" />
        </svg>
        返回 AI 导入历史
      </Link>
      <div className="detail-heading data-transfer-detail-heading">
        <div>
          <span className="detail-label">AI 导入记录</span>
          <OverflowText content={batch.data.topic} lines={2} mode="always">
            <h1 id="ai-import-detail-title">{batch.data.topic}</h1>
          </OverflowText>
        </div>
      </div>

      <dl className="data-transfer-summary-grid data-transfer-ai-summary-grid">
        <div>
          <dt>完成时间</dt>
          <dd>{completedAtFormatter.format(new Date(batch.data.completedAt))}</dd>
        </div>
        <div>
          <dt>方案版本</dt>
          <dd>版本 {batch.data.planVersion}</dd>
        </div>
        <div>
          <dt>客户端</dt>
          <dd>
            <OverflowText content={batch.data.clientName} mode="always">
              <span>{batch.data.clientName}</span>
            </OverflowText>
          </dd>
        </div>
        <div>
          <dt>处理结果</dt>
          <dd>{hasBusinessChanges(batch.data) ? '成功' : '成功·无变化'}</dd>
        </div>
        <div>
          <dt>原子事件</dt>
          <dd>
            新增 {counts.eventCreated} / 复用 {counts.eventReused} / 更新 {counts.eventUpdated}
          </dd>
        </div>
        <div>
          <dt>具体案例</dt>
          <dd>
            新增 {counts.caseCreated} / 复用 {counts.caseReused}
          </dd>
        </div>
        <div>
          <dt>因果关系</dt>
          <dd>
            新增 {counts.relationCreated} / 复用 {counts.relationReused}
          </dd>
        </div>
        <div>
          <dt>属性与关联</dt>
          <dd>
            事件更新 {counts.eventUpdated} / 案例关联 {counts.relationCaseCreated} / 置信度变化{' '}
            {counts.confidenceChanged}
          </dd>
        </div>
      </dl>

      <div className="data-transfer-detail-records">
        <AppTabs
          id="ai-import-record-type"
          label="AI 导入明细类型"
          value={activeTab.value}
          tabs={detailTabs}
          onChange={(value) => {
            const next = new URLSearchParams(searchParameters);
            next.set('tab', value);
            setSearchParameters(next, { state: location.state });
          }}
        >
          {records.isPending && !recordData ? (
            <div className="table-state">加载 AI 导入明细…</div>
          ) : null}
          {records.isError ? (
            <div className="table-state table-state--error" role="alert">
              <strong>无法加载 AI 导入明细</strong>
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
              <strong>没有这类 AI 导入明细</strong>
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
                            className={`data-transfer-outcome data-transfer-outcome--${record.action}`}
                          >
                            {actionLabels[record.action]}
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
