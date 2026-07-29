import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';

import { AppTabs } from '../../shared/controls/AppTabs';
import { AppDialog } from '../../shared/dialog/AppDialog';
import { useAutoDismissError } from '../../shared/forms/useAutoDismissError';
import { createListReturnState } from '../../shared/navigation/listReturn';
import { useListRecordFocus } from '../../shared/navigation/useListRecordFocus';
import { readListPage } from '../../shared/pagination/ListPagination';
import { AiImportHistoryTable } from './components/AiImportHistoryTable';
import { ImportHistoryTable } from './components/ImportHistoryTable';
import { ImportPanel } from './components/ImportPanel';
import { ExportPanel } from './components/ExportPanel';
import { getAiImportHistory, getImportHistory, uploadImport } from './dataTransferApi';
import { useImportNavigationProtection } from './useImportNavigationProtection';

const dataTransferTabs = [
  { value: 'import', label: '文件导入' },
  { value: 'export', label: '文件导出' },
  { value: 'aiHistory', label: 'AI 导入历史' },
] as const;

export function DataTransferPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParameters, setSearchParameters] = useSearchParams();
  const page = readListPage(searchParameters.get('page'));
  const requestedTab = searchParameters.get('tab');
  const activeTab =
    requestedTab === 'export' || requestedTab === 'aiHistory' ? requestedTab : 'import';
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorRevision, setErrorRevision] = useState(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (requestedTab === activeTab && searchParameters.get('page') === String(page)) {
      return;
    }
    const next = new URLSearchParams(searchParameters);
    next.set('tab', activeTab);
    next.set('page', String(page));
    setSearchParameters(next, { replace: true });
  }, [activeTab, page, requestedTab, searchParameters, setSearchParameters]);

  const history = useQuery({
    queryKey: ['data-transfers', 'imports', page],
    queryFn: async ({ signal }) => ({
      requestedPage: page,
      response: await getImportHistory(page, signal),
    }),
    enabled: activeTab === 'import',
    placeholderData: (previous) => previous,
  });
  const historyData = history.data?.response;
  const aiHistory = useQuery({
    queryKey: ['ai-captures', 'history', page],
    queryFn: async ({ signal }) => ({
      requestedPage: page,
      response: await getAiImportHistory(page, signal),
    }),
    enabled: activeTab === 'aiHistory',
    placeholderData: (previous) => previous,
  });
  const aiHistoryData = aiHistory.data?.response;

  useEffect(() => {
    if (
      activeTab !== 'import' ||
      history.isFetching ||
      history.isPlaceholderData ||
      history.data?.requestedPage !== page ||
      historyData?.page === undefined ||
      historyData.page === page
    ) {
      return;
    }
    const next = new URLSearchParams(searchParameters);
    next.set('page', String(historyData.page));
    setSearchParameters(next, { replace: true });
  }, [
    activeTab,
    history.data?.requestedPage,
    history.isFetching,
    history.isPlaceholderData,
    historyData?.page,
    page,
    searchParameters,
    setSearchParameters,
  ]);

  useEffect(() => {
    if (
      activeTab !== 'aiHistory' ||
      aiHistory.isFetching ||
      aiHistory.isPlaceholderData ||
      aiHistory.data?.requestedPage !== page ||
      aiHistoryData?.page === undefined ||
      aiHistoryData.page === page
    ) {
      return;
    }
    const next = new URLSearchParams(searchParameters);
    next.set('page', String(aiHistoryData.page));
    setSearchParameters(next, { replace: true });
  }, [
    activeTab,
    aiHistory.data?.requestedPage,
    aiHistory.isFetching,
    aiHistory.isPlaceholderData,
    aiHistoryData?.page,
    page,
    searchParameters,
    setSearchParameters,
  ]);

  useListRecordFocus(
    activeTab === 'import'
      ? (historyData?.items.map((batch) => batch.id) ?? [])
      : activeTab === 'aiHistory'
        ? (aiHistoryData?.items.map((batch) => batch.id) ?? [])
        : [],
  );

  const upload = useMutation({
    mutationFn: ({ selectedFile, signal }: { selectedFile: File; signal: AbortSignal }) =>
      uploadImport(selectedFile, signal),
    onSuccess: (batch) => {
      abortControllerRef.current = null;
      navigate(
        `/data-transfer/imports/${batch.id}?tab=events&eventPage=1&casePage=1&relationPage=1&relationCasePage=1`,
        { state: createListReturnState(location, batch.id) },
      );
    },
    onError: (uploadError) => {
      abortControllerRef.current = null;
      if (uploadError instanceof DOMException && uploadError.name === 'AbortError') return;
      setError(uploadError instanceof Error ? uploadError.message : '导入失败，请重试');
      setErrorRevision((revision) => revision + 1);
    },
  });
  useAutoDismissError(Boolean(error), errorRevision, () => setError(null));
  const blocker = useImportNavigationProtection(upload.isPending);

  function changePage(nextPage: number): void {
    const next = new URLSearchParams(searchParameters);
    next.set('tab', activeTab);
    next.set('page', String(nextPage));
    setSearchParameters(next);
  }

  function startImport(): void {
    if (!file || upload.isPending) return;
    setError(null);
    const controller = new AbortController();
    abortControllerRef.current = controller;
    upload.mutate({ selectedFile: file, signal: controller.signal });
  }

  return (
    <section className="data-transfer-page" aria-labelledby="data-transfer-title">
      <div className="page-heading">
        <div>
          <h1 id="data-transfer-title">导入导出</h1>
          <p>通过 CSV 批量交换因果关系数据</p>
        </div>
      </div>

      <div className="data-transfer-surface">
        <AppTabs
          id="data-transfer-mode"
          label="导入导出功能"
          value={activeTab}
          tabs={dataTransferTabs}
          onChange={(nextTab) => {
            const next = new URLSearchParams(searchParameters);
            next.set('tab', nextTab);
            next.set('page', String(page));
            setSearchParameters(next);
          }}
        >
          {activeTab === 'import' ? (
            <>
              <ImportPanel
                file={file}
                pending={upload.isPending}
                error={error}
                onFileChange={(selectedFile) => {
                  setFile(selectedFile);
                  setError(null);
                }}
                onSubmit={startImport}
              />

              <section className="data-transfer-history" aria-labelledby="import-history-title">
                <div className="data-transfer-section-heading">
                  <div>
                    <h2 id="import-history-title">导入历史</h2>
                    <p>仅记录已经成功提交的导入批次。</p>
                  </div>
                </div>
                {history.isPending && !historyData ? (
                  <div className="table-state">加载导入历史…</div>
                ) : null}
                {history.isError ? (
                  <div className="table-state table-state--error" role="alert">
                    <strong>无法加载导入历史</strong>
                    <button
                      className="button button--secondary"
                      type="button"
                      onClick={() => void history.refetch()}
                    >
                      重新加载
                    </button>
                  </div>
                ) : null}
                {historyData ? (
                  <ImportHistoryTable
                    data={historyData}
                    fetching={history.isFetching}
                    location={location}
                    onPageChange={changePage}
                  />
                ) : null}
              </section>
            </>
          ) : activeTab === 'export' ? (
            <ExportPanel />
          ) : (
            <section
              className="data-transfer-history data-transfer-ai-history"
              aria-labelledby="ai-import-history-title"
            >
              <div className="data-transfer-section-heading">
                <div>
                  <h2 id="ai-import-history-title">AI 导入历史</h2>
                  <p>仅记录已经成功提交的 AI 采集入库批次。</p>
                </div>
              </div>
              {aiHistory.isPending && !aiHistoryData ? (
                <div className="table-state">加载 AI 导入历史…</div>
              ) : null}
              {aiHistory.isError ? (
                <div className="table-state table-state--error" role="alert">
                  <strong>无法加载 AI 导入历史</strong>
                  <button
                    className="button button--secondary"
                    type="button"
                    onClick={() => void aiHistory.refetch()}
                  >
                    重新加载
                  </button>
                </div>
              ) : null}
              {aiHistoryData ? (
                <AiImportHistoryTable
                  data={aiHistoryData}
                  fetching={aiHistory.isFetching}
                  location={location}
                  onPageChange={changePage}
                />
              ) : null}
            </section>
          )}
        </AppTabs>
      </div>

      <AppDialog
        open={blocker.state === 'blocked'}
        title="离开导入页面"
        descriptionId="leave-import-description"
        onClose={() => {
          if (blocker.state === 'blocked') blocker.reset();
        }}
        actions={
          <>
            <button
              className="button button--secondary"
              type="button"
              onClick={() => {
                if (blocker.state === 'blocked') blocker.reset();
              }}
            >
              继续导入
            </button>
            <button
              className="button button--primary"
              type="button"
              onClick={() => {
                if (blocker.state !== 'blocked') return;
                abortControllerRef.current?.abort();
                blocker.proceed();
              }}
            >
              确认离开
            </button>
          </>
        }
      >
        <p id="leave-import-description">离开将取消本次导入</p>
      </AppDialog>
    </section>
  );
}
