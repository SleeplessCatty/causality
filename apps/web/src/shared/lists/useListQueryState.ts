import type { SearchMode } from '@causality/contracts';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';

import { readListPage } from '../pagination/ListPagination';

interface UseListQueryStateOptions {
  clearOnQueryChange?: string;
  clearOnPageChange?: string;
}

export function useListQueryState({
  clearOnQueryChange,
  clearOnPageChange,
}: UseListQueryStateOptions = {}) {
  const [searchParameters, setSearchParameters] = useSearchParams();
  const query = searchParameters.get('q') ?? '';
  const page = readListPage(searchParameters.get('page'));
  const searchMode: SearchMode =
    query && searchParameters.get('searchMode') === 'enhanced' ? 'enhanced' : 'standard';
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
          next.delete('searchMode');
          if (clearOnQueryChange) next.delete(clearOnQueryChange);
          return next;
        },
        { replace: true },
      );
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [clearOnQueryChange, query, searchInput, setSearchParameters]);

  const changePage = useCallback(
    (nextPage: number) => {
      setSearchParameters((current) => {
        const next = new URLSearchParams(current);
        if (clearOnPageChange) next.delete(clearOnPageChange);
        next.set('page', String(nextPage));
        return next;
      });
    },
    [clearOnPageChange, setSearchParameters],
  );

  const activateEnhancedSearch = useCallback(() => {
    setSearchParameters((current) => {
      const next = new URLSearchParams(current);
      if (!next.get('q')?.trim()) {
        next.delete('searchMode');
        return next;
      }
      next.set('searchMode', 'enhanced');
      next.set('page', '1');
      if (clearOnPageChange) next.delete(clearOnPageChange);
      return next;
    });
  }, [clearOnPageChange, setSearchParameters]);

  const deactivateEnhancedSearch = useCallback(() => {
    setSearchParameters(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('searchMode');
        return next;
      },
      { replace: true },
    );
  }, [setSearchParameters]);

  return {
    searchParameters,
    setSearchParameters,
    query,
    page,
    searchInput,
    setSearchInput,
    changePage,
    enhancedSearchController: {
      mode: searchMode,
      activateEnhanced: activateEnhancedSearch,
      deactivateEnhanced: deactivateEnhancedSearch,
    },
  };
}

interface ListPageCorrectionOptions {
  requestedPage: number;
  responsePage: number | undefined;
  isPlaceholderData: boolean;
  setSearchParameters: ReturnType<typeof useSearchParams>[1];
  navigationState?: unknown;
}

export function useListPageCorrection({
  requestedPage,
  responsePage,
  isPlaceholderData,
  setSearchParameters,
  navigationState,
}: ListPageCorrectionOptions): void {
  useEffect(() => {
    if (responsePage === undefined || isPlaceholderData || responsePage === requestedPage) return;
    setSearchParameters(
      (current) => {
        const next = new URLSearchParams(current);
        next.set('page', String(responsePage));
        return next;
      },
      { replace: true, state: navigationState },
    );
  }, [
    isPlaceholderData,
    navigationState,
    requestedPage,
    responsePage,
    setSearchParameters,
  ]);
}
