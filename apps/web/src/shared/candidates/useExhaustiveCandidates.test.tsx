import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useExhaustiveCandidates } from './useExhaustiveCandidates';

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('useExhaustiveCandidates', () => {
  it('automatically reads every page and deduplicates repeated ids', async () => {
    const loadPage = vi
      .fn()
      .mockResolvedValueOnce({
        items: [{ id: '1', name: '第一项' }],
        nextCursor: 'next',
        hasMore: true,
      })
      .mockResolvedValueOnce({
        items: [
          { id: '1', name: '第一项' },
          { id: '2', name: '第二项' },
        ],
        nextCursor: null,
        hasMore: false,
      });

    const { result } = renderHook(
      () =>
        useExhaustiveCandidates({
          queryKey: ['test-candidates'],
          query: '测试',
          enabled: true,
          loadPage,
          getId: (item: { id: string }) => item.id,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual(['1', '2']));
    expect(loadPage).toHaveBeenNthCalledWith(2, '测试', 'next', expect.any(AbortSignal));
  });

  it('keeps a failed next page retryable without clearing the first page', async () => {
    const loadPage = vi
      .fn()
      .mockResolvedValueOnce({
        items: [{ id: '1', name: '第一项' }],
        nextCursor: 'next',
        hasMore: true,
      })
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({
        items: [{ id: '2', name: '第二项' }],
        nextCursor: null,
        hasMore: false,
      });

    const { result } = renderHook(
      () =>
        useExhaustiveCandidates({
          queryKey: ['retry-candidates'],
          query: '测试',
          enabled: true,
          loadPage,
          getId: (item: { id: string }) => item.id,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.nextPageError).toBeTruthy());
    expect(result.current.items.map((item) => item.id)).toEqual(['1']);
    await result.current.retryNextPage();
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual(['1', '2']));
  });

  it('never adds a stale page after the search query changes', async () => {
    let resolveOldPage:
      | ((page: {
          items: { id: string; name: string }[];
          nextCursor: null;
          hasMore: false;
        }) => void)
      | undefined;
    const oldPage = new Promise<{
      items: { id: string; name: string }[];
      nextCursor: null;
      hasMore: false;
    }>((resolve) => {
      resolveOldPage = resolve;
    });
    const loadPage = vi.fn((search: string) =>
      search === '旧查询'
        ? oldPage
        : Promise.resolve({
            items: [{ id: 'new', name: '新结果' }],
            nextCursor: null,
            hasMore: false,
          }),
    );

    const { result, rerender } = renderHook(
      ({ query }) =>
        useExhaustiveCandidates({
          queryKey: ['changing-candidates'],
          query,
          enabled: true,
          loadPage,
          getId: (item: { id: string }) => item.id,
        }),
      { wrapper: createWrapper(), initialProps: { query: '旧查询' } },
    );

    rerender({ query: '新查询' });
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual(['new']));
    resolveOldPage?.({
      items: [{ id: 'old', name: '旧结果' }],
      nextCursor: null,
      hasMore: false,
    });
    await Promise.resolve();
    expect(result.current.items.map((item) => item.id)).toEqual(['new']);
  });
});
