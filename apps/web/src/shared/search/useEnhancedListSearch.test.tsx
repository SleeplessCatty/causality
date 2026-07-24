import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiClientError } from '../api/httpClient';
import { useEnhancedListSearch } from './useEnhancedListSearch';

describe('useEnhancedListSearch', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects a blank query without starting a request', () => {
    const resetPage = vi.fn();
    const { result } = renderHook(() => useEnhancedListSearch({ normalizedQuery: '', resetPage }));

    act(() => result.current.requestEnhanced());

    expect(result.current.mode).toBe('standard');
    expect(result.current.isEnhancing).toBe(false);
    expect(result.current.notice?.message).toBe('请先输入搜索内容');
    expect(resetPage).not.toHaveBeenCalled();
  });

  it('enters enhanced mode, resets page one, and keeps the mode across pagination', () => {
    const resetPage = vi.fn();
    const { result, rerender } = renderHook(
      ({ query }) => useEnhancedListSearch({ normalizedQuery: query, resetPage }),
      { initialProps: { query: '政策收紧' } },
    );

    act(() => result.current.requestEnhanced());
    expect(result.current.mode).toBe('enhanced');
    expect(result.current.isEnhancing).toBe(true);
    expect(resetPage).toHaveBeenCalledWith(1);

    rerender({ query: '政策收紧' });
    expect(result.current.mode).toBe('enhanced');
  });

  it('returns to standard mode when the query changes or the hook remounts', () => {
    const resetPage = vi.fn();
    const { result, rerender, unmount } = renderHook(
      ({ query }) => useEnhancedListSearch({ normalizedQuery: query, resetPage }),
      { initialProps: { query: '政策收紧' } },
    );

    act(() => result.current.requestEnhanced());
    rerender({ query: '利率上升' });
    expect(result.current.mode).toBe('standard');
    expect(result.current.isEnhancing).toBe(false);

    unmount();
    const remounted = renderHook(() =>
      useEnhancedListSearch({ normalizedQuery: '利率上升', resetPage }),
    );
    expect(remounted.result.current.mode).toBe('standard');
  });

  it('maps semantic failures, resets the mode, links index failures, and auto dismisses errors', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useEnhancedListSearch({ normalizedQuery: '政策收紧', resetPage: vi.fn() }),
    );

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
    const { result } = renderHook(() =>
      useEnhancedListSearch({ normalizedQuery: '政策收紧', resetPage: vi.fn() }),
    );

    act(() => result.current.requestEnhanced());
    act(() =>
      result.current.reportEnhancedError(new ApiClientError({ code, message: '内部错误详情' })),
    );

    expect(result.current.notice).toEqual({ tone: 'error', message });
  });

  it('reports a non-blocking notice when a successful result uses an updating index', () => {
    const { result } = renderHook(() =>
      useEnhancedListSearch({ normalizedQuery: '政策收紧', resetPage: vi.fn() }),
    );

    act(() => result.current.requestEnhanced());
    act(() => result.current.reportEnhancedSuccess(true));

    expect(result.current.mode).toBe('enhanced');
    expect(result.current.isEnhancing).toBe(false);
    expect(result.current.notice).toEqual({
      tone: 'info',
      message: '语义索引更新中，结果可能暂不包含最新修改',
    });
  });
});
