import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

export interface CandidatePage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

interface UseExhaustiveCandidatesOptions<T extends { id: string }> {
  queryKey: readonly unknown[];
  query: string;
  enabled: boolean;
  loadPage: (
    query: string,
    cursor: string | undefined,
    signal: AbortSignal,
  ) => Promise<CandidatePage<T>>;
}

export function useExhaustiveCandidates<T extends { id: string }>({
  queryKey,
  query,
  enabled,
  loadPage,
}: UseExhaustiveCandidatesOptions<T>) {
  const result = useInfiniteQuery({
    queryKey: [...queryKey, query],
    queryFn: ({ pageParam, signal }) => loadPage(query, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore && lastPage.nextCursor ? lastPage.nextCursor : undefined,
    enabled,
    retry: false,
  });

  useEffect(() => {
    if (result.hasNextPage && !result.isFetchingNextPage && !result.isFetchNextPageError) {
      void result.fetchNextPage();
    }
  }, [
    result.fetchNextPage,
    result.hasNextPage,
    result.isFetchingNextPage,
    result.isFetchNextPageError,
  ]);

  const items = useMemo(() => {
    const unique = new Map<string, T>();
    for (const page of result.data?.pages ?? []) {
      for (const item of page.items) unique.set(item.id, item);
    }
    return [...unique.values()];
  }, [result.data?.pages]);

  return {
    items,
    isPending: result.isPending,
    isInitialError: result.isError && !result.data,
    initialError: result.isError && !result.data ? result.error : null,
    isFetchingNextPage: result.isFetchingNextPage,
    nextPageError: result.isFetchNextPageError ? result.error : null,
    hasLoadedPage: Boolean(result.data?.pages.length),
    retryNextPage: async () => {
      await result.fetchNextPage();
    },
  };
}
