import type { SearchMode, SemanticIndexNotice } from '@causality/contracts';
import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiClientError } from '../api/httpClient';
import { useEnhancedListSearch } from './useEnhancedListSearch';

function useEnhancedSearchHarness(normalizedQuery: string, initialMode: SearchMode = 'standard') {
  const [mode, setMode] = useState<SearchMode>(initialMode);
  return useEnhancedListSearch({
    normalizedQuery,
    mode,
    activateEnhanced: () => setMode('enhanced'),
    deactivateEnhanced: () => setMode('standard'),
  });
}

describe('useEnhancedListSearch', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects a blank query without starting a request', () => {
    const { result } = renderHook(() => useEnhancedSearchHarness(''));

    act(() => result.current.requestEnhanced());

    expect(result.current.mode).toBe('standard');
    expect(result.current.isEnhancing).toBe(false);
    expect(result.current.notice?.message).toBe('请先输入搜索内容');
  });

  it('enters enhanced mode and keeps the mode while the query is unchanged', () => {
    const { result, rerender } = renderHook(({ query }) => useEnhancedSearchHarness(query), {
      initialProps: { query: '政策收紧' },
    });

    act(() => result.current.requestEnhanced());
    expect(result.current.mode).toBe('enhanced');
    expect(result.current.isEnhancing).toBe(true);

    rerender({ query: '政策收紧' });
    expect(result.current.mode).toBe('enhanced');
  });

  it('returns to standard mode when the query changes or the hook remounts', () => {
    const { result, rerender, unmount } = renderHook(
      ({ query }) => useEnhancedSearchHarness(query),
      { initialProps: { query: '政策收紧' } },
    );

    act(() => result.current.requestEnhanced());
    rerender({ query: '利率上升' });
    expect(result.current.mode).toBe('standard');
    expect(result.current.isEnhancing).toBe(false);

    unmount();
    const remounted = renderHook(() => useEnhancedSearchHarness('利率上升'));
    expect(remounted.result.current.mode).toBe('standard');
  });

  it('maps semantic failures, resets the mode, links index failures, and auto dismisses errors', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useEnhancedSearchHarness('政策收紧'));

    act(() => result.current.requestEnhanced());
    act(() =>
      result.current.reportEnhancedError(
        new ApiClientError({
          code: 'SEMANTIC_INDEX_FAILED',
          message: 'internal semantic detail',
        }),
      ),
    );

    expect(result.current.mode).toBe('standard');
    expect(result.current.notice).toEqual({
      tone: 'error',
      message: '语义索引生成失败',
      settingsLink: true,
    });

    act(() => vi.advanceTimersByTime(3_000));
    expect(result.current.notice).toBeNull();
  });

  it.each([
    ['SEMANTIC_MODEL_UNAVAILABLE', '尚未下载并使用语义模型'],
    ['SEMANTIC_MODEL_DOWNLOADING', '模型正在下载，增强查询暂不可用'],
    ['SEMANTIC_INDEX_BUILDING', '语义索引正在生成，增强查询暂不可用'],
    ['SEMANTIC_WORKER_UNAVAILABLE', '语义服务暂不可用'],
  ] as const)('maps %s to its concise unavailable reason', (code, message) => {
    const { result } = renderHook(() => useEnhancedSearchHarness('政策收紧'));

    act(() => result.current.requestEnhanced());
    act(() =>
      result.current.reportEnhancedError(new ApiClientError({ code, message: '内部错误详情' })),
    );

    expect(result.current.notice).toEqual({ tone: 'error', message });
  });

  it.each([
    [null, null],
    [
      'updating',
      {
        tone: 'info',
        message: '语义索引尚在同步，结果可能暂不包含最新修改',
      },
    ],
    [
      'incomplete',
      {
        tone: 'info',
        message: '语义索引不完整，结果可能缺少部分记录',
        settingsLink: true,
      },
    ],
  ] satisfies ReadonlyArray<
    readonly [SemanticIndexNotice, { tone: 'info'; message: string; settingsLink?: true } | null]
  >)('maps successful semantic notice %s to shared list feedback', (notice, expected) => {
    const { result } = renderHook(() => useEnhancedSearchHarness('政策收紧'));

    act(() => result.current.requestEnhanced());
    act(() => result.current.reportEnhancedSuccess(notice));

    expect(result.current.mode).toBe('enhanced');
    expect(result.current.isEnhancing).toBe(false);
    expect(result.current.notice).toEqual(expected);
  });
});
