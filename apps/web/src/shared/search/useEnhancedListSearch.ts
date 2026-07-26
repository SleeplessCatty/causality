import type { ApiErrorCode, SearchMode } from '@causality/contracts';
import { useCallback, useEffect, useState } from 'react';

import { ApiClientError } from '../api/httpClient';
import { useAutoDismissError } from '../forms/useAutoDismissError';

export interface EnhancedSearchNotice {
  tone: 'error' | 'info';
  message: string;
  settingsLink?: boolean;
}

interface UseEnhancedListSearchOptions {
  normalizedQuery: string;
  mode: SearchMode;
  activateEnhanced(): void;
  deactivateEnhanced(): void;
}

export interface EnhancedListSearchState {
  mode: SearchMode;
  requestEnhanced(): void;
  isEnhancing: boolean;
  notice: EnhancedSearchNotice | null;
  requestId: number;
  reportEnhancedError(error: unknown): boolean;
  reportEnhancedSuccess(semanticIndexUpdating: boolean): void;
}

interface EnhancedListQueryResult {
  data: { semanticIndexUpdating: boolean } | undefined;
  error: unknown;
  isFetching: boolean;
  isPlaceholderData: boolean;
  isSuccess: boolean;
}

const semanticMessages: Partial<Record<ApiErrorCode, string>> = {
  SEMANTIC_MODEL_UNAVAILABLE: '尚未下载并使用语义模型',
  SEMANTIC_MODEL_DOWNLOADING: '模型正在下载，增强查询暂不可用',
  SEMANTIC_INDEX_BUILDING: '语义索引正在生成，增强查询暂不可用',
  SEMANTIC_INDEX_FAILED: '语义索引生成失败',
  SEMANTIC_WORKER_UNAVAILABLE: '语义服务暂不可用',
};

function semanticErrorMessage(error: unknown): string | null {
  if (!(error instanceof ApiClientError)) return null;
  return semanticMessages[error.details.code] ?? null;
}

export function isSemanticSearchError(error: unknown): boolean {
  return semanticErrorMessage(error) !== null;
}

export function useEnhancedListSearch({
  normalizedQuery,
  mode,
  activateEnhanced,
  deactivateEnhanced,
}: UseEnhancedListSearchOptions): EnhancedListSearchState {
  const [activeQuery, setActiveQuery] = useState(normalizedQuery);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [notice, setNotice] = useState<EnhancedSearchNotice | null>(null);
  const [errorRevision, setErrorRevision] = useState(0);
  const [requestId, setRequestId] = useState(0);
  const queryChanged = activeQuery !== normalizedQuery;

  useEffect(() => {
    if (activeQuery === normalizedQuery) return;
    setActiveQuery(normalizedQuery);
    if (mode === 'enhanced') deactivateEnhanced();
    setIsEnhancing(false);
    setNotice(null);
  }, [activeQuery, deactivateEnhanced, mode, normalizedQuery]);

  const dismissError = useCallback(() => {
    setNotice((current) => (current?.tone === 'error' ? null : current));
  }, []);
  useAutoDismissError(notice?.tone === 'error', errorRevision, dismissError);

  const showError = useCallback((message: string, settingsLink = false) => {
    setNotice({ tone: 'error', message, ...(settingsLink ? { settingsLink: true } : {}) });
    setErrorRevision((current) => current + 1);
  }, []);

  const requestEnhanced = useCallback(() => {
    if (!normalizedQuery) {
      showError('请先输入搜索内容');
      return;
    }
    setNotice(null);
    setIsEnhancing(true);
    setRequestId((current) => current + 1);
    activateEnhanced();
  }, [activateEnhanced, normalizedQuery, showError]);

  const reportEnhancedError = useCallback(
    (error: unknown): boolean => {
      const message = semanticErrorMessage(error);
      setIsEnhancing(false);
      if (!message) return false;
      deactivateEnhanced();
      showError(
        message,
        error instanceof ApiClientError && error.details.code === 'SEMANTIC_INDEX_FAILED',
      );
      return true;
    },
    [deactivateEnhanced, showError],
  );

  const reportEnhancedSuccess = useCallback((semanticIndexUpdating: boolean) => {
    setIsEnhancing(false);
    setNotice(
      semanticIndexUpdating
        ? {
            tone: 'info',
            message: '语义索引更新中，结果可能暂不包含最新修改',
          }
        : null,
    );
  }, []);

  return {
    mode: queryChanged ? 'standard' : mode,
    requestEnhanced,
    isEnhancing: queryChanged ? false : isEnhancing,
    notice: queryChanged ? null : notice,
    requestId,
    reportEnhancedError,
    reportEnhancedSuccess,
  };
}

export function useEnhancedListSearchResult(
  search: EnhancedListSearchState,
  result: EnhancedListQueryResult,
): void {
  useEffect(() => {
    if (search.mode !== 'enhanced') return;
    if (result.error) {
      search.reportEnhancedError(result.error);
      return;
    }
    if (result.isSuccess && !result.isFetching && !result.isPlaceholderData && result.data) {
      search.reportEnhancedSuccess(result.data.semanticIndexUpdating);
    }
  }, [
    result.data,
    result.error,
    result.isFetching,
    result.isPlaceholderData,
    result.isSuccess,
    search.mode,
    search.reportEnhancedError,
    search.reportEnhancedSuccess,
  ]);
}
