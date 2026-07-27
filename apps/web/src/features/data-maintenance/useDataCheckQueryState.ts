import {
  dataCheckIssueTypeOptions,
  type DataCheckIssueStatus,
  type DataCheckIssueType,
  type DataCheckSeverity,
} from '@causality/contracts';
import { useCallback, useEffect } from 'react';
import { useLocation, useSearchParams } from 'react-router';

import { readListPage } from '../../shared/pagination/ListPagination';

const issueTypes = new Set<DataCheckIssueType>(dataCheckIssueTypeOptions.map(({ value }) => value));
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface DataCheckQueryState {
  page: number;
  severity: DataCheckSeverity | '';
  issueType: DataCheckIssueType | '';
  status: DataCheckIssueStatus | '';
  expandedId: string | null;
  changePage(page: number): void;
  changeSeverity(value: DataCheckSeverity | ''): void;
  changeIssueType(value: DataCheckIssueType | ''): void;
  changeStatus(value: DataCheckIssueStatus | ''): void;
  toggleExpanded(issueId: string): void;
  clearExpanded(): void;
  resetForSnapshot(): void;
}

export function useDataCheckQueryState(): DataCheckQueryState {
  const location = useLocation();
  const [searchParameters, setSearchParameters] = useSearchParams();
  const rawPage = searchParameters.get('page');
  const page = readListPage(rawPage);
  const rawSeverity = searchParameters.get('severity');
  const severity: DataCheckSeverity | '' =
    rawSeverity === 'error' || rawSeverity === 'warning' ? rawSeverity : '';
  const rawIssueType = searchParameters.get('issueType');
  const issueType: DataCheckIssueType | '' =
    rawIssueType && issueTypes.has(rawIssueType as DataCheckIssueType)
      ? (rawIssueType as DataCheckIssueType)
      : '';
  const rawStatus = searchParameters.get('status');
  const status: DataCheckIssueStatus | '' =
    rawStatus === 'open' || rawStatus === 'handled' ? rawStatus : '';
  const rawExpandedId = searchParameters.get('expanded');
  const expandedId = rawExpandedId && uuidPattern.test(rawExpandedId) ? rawExpandedId : null;

  useEffect(() => {
    const next = new URLSearchParams(searchParameters);
    if (rawPage !== null && (page === 1 || rawPage !== String(page))) next.delete('page');
    if (rawSeverity !== null && !severity) next.delete('severity');
    if (rawIssueType !== null && !issueType) next.delete('issueType');
    if (rawStatus !== null && !status) next.delete('status');
    if (rawExpandedId !== null && !expandedId) next.delete('expanded');
    if (next.toString() !== searchParameters.toString()) {
      setSearchParameters(next, { replace: true, state: location.state });
    }
  }, [
    expandedId,
    issueType,
    location.state,
    page,
    rawExpandedId,
    rawIssueType,
    rawPage,
    rawSeverity,
    rawStatus,
    searchParameters,
    setSearchParameters,
    severity,
    status,
  ]);

  const updateFilter = useCallback(
    (key: 'severity' | 'issueType' | 'status', value: string) => {
      setSearchParameters(
        (current) => {
          const next = new URLSearchParams(current);
          if (value) next.set(key, value);
          else next.delete(key);
          next.delete('page');
          next.delete('expanded');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParameters],
  );

  const changePage = useCallback(
    (nextPage: number) => {
      setSearchParameters(
        (current) => {
          const next = new URLSearchParams(current);
          if (nextPage <= 1) next.delete('page');
          else next.set('page', String(nextPage));
          next.delete('expanded');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParameters],
  );

  const toggleExpanded = useCallback(
    (nextIssueId: string) => {
      setSearchParameters(
        (current) => {
          const next = new URLSearchParams(current);
          if (next.get('expanded') === nextIssueId) next.delete('expanded');
          else next.set('expanded', nextIssueId);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParameters],
  );

  const clearExpanded = useCallback(() => {
    setSearchParameters(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('expanded');
        return next;
      },
      { replace: true },
    );
  }, [setSearchParameters]);

  const resetForSnapshot = useCallback(() => {
    setSearchParameters(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('page');
        next.delete('expanded');
        return next;
      },
      { replace: true },
    );
  }, [setSearchParameters]);

  return {
    page,
    severity,
    issueType,
    status,
    expandedId,
    changePage,
    changeSeverity: useCallback((value) => updateFilter('severity', value), [updateFilter]),
    changeIssueType: useCallback((value) => updateFilter('issueType', value), [updateFilter]),
    changeStatus: useCallback((value) => updateFilter('status', value), [updateFilter]),
    toggleExpanded,
    clearExpanded,
    resetForSnapshot,
  };
}
