import type { DataCheckIssueStatus, DataCheckSeverity } from '@causality/contracts';
import { useCallback, useEffect } from 'react';
import { useLocation, useSearchParams } from 'react-router';

import { readListPage } from '../../shared/pagination/ListPagination';

export const dataCheckIssueTypeOptions = [
  ['missing_relation_cause_event', '原因事件引用失效'],
  ['missing_relation_effect_event', '结果事件引用失效'],
  ['delete_missing_alias', '失效别名'],
  ['delete_missing_keyword', '失效关键词'],
  ['delete_missing_relation_case', '失效关系案例关联'],
  ['relation_self_loop', '关系自环'],
  ['relation_confidence_range', '置信度范围'],
  ['duplicate_relation_direction', '同方向重复关系'],
  ['duplicate_event_name', '重复事件名称'],
  ['duplicate_case_content', '重复案例内容'],
  ['delete_duplicate_alias', '重复别名'],
  ['delete_duplicate_keyword', '重复关键词'],
  ['resequence_keywords', '关键词位置'],
  ['invalid_event_name', '事件名称异常'],
  ['invalid_case_content', '案例内容异常'],
  ['invalid_alias_text', '别名内容异常'],
  ['invalid_keyword_text', '关键词内容异常'],
  ['invalid_event_description', '事件说明异常'],
  ['invalid_relation_description', '关系说明异常'],
  ['invalid_event_timestamp_order', '事件时间异常'],
  ['invalid_relation_timestamp_order', '关系时间异常'],
  ['invalid_case_timestamp_order', '案例时间异常'],
  ['cross_event_alias_name', '别名与事件名称冲突'],
  ['cross_event_shared_alias', '跨事件共享别名'],
  ['semantic_duplicate_event', '语义重复事件'],
  ['semantic_duplicate_case', '语义重复案例'],
] as const;

const issueTypes = new Set<string>(dataCheckIssueTypeOptions.map(([value]) => value));
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface DataCheckQueryState {
  page: number;
  severity: DataCheckSeverity | '';
  issueType: string;
  status: DataCheckIssueStatus | '';
  issueId: string | null;
  recheck: boolean;
  changePage(page: number): void;
  changeSeverity(value: DataCheckSeverity | ''): void;
  changeIssueType(value: string): void;
  changeStatus(value: DataCheckIssueStatus | ''): void;
  openIssue(issueId: string): void;
  closeIssue(): void;
  resetForSnapshot(): void;
  consumeRecheck(): void;
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
  const issueType = rawIssueType && issueTypes.has(rawIssueType) ? rawIssueType : '';
  const rawStatus = searchParameters.get('status');
  const status: DataCheckIssueStatus | '' =
    rawStatus === 'open' || rawStatus === 'handled' ? rawStatus : '';
  const rawIssueId = searchParameters.get('issue');
  const issueId = rawIssueId && uuidPattern.test(rawIssueId) ? rawIssueId : null;
  const recheck = searchParameters.get('recheck') === '1' && issueId !== null;

  useEffect(() => {
    const next = new URLSearchParams(searchParameters);
    if (rawPage !== null && (page === 1 || rawPage !== String(page))) next.delete('page');
    if (rawSeverity !== null && !severity) next.delete('severity');
    if (rawIssueType !== null && !issueType) next.delete('issueType');
    if (rawStatus !== null && !status) next.delete('status');
    if (rawIssueId !== null && !issueId) next.delete('issue');
    if (searchParameters.has('recheck') && !recheck) next.delete('recheck');
    if (next.toString() !== searchParameters.toString())
      setSearchParameters(next, { replace: true });
  }, [
    issueId,
    issueType,
    page,
    rawIssueId,
    rawIssueType,
    rawPage,
    rawSeverity,
    rawStatus,
    recheck,
    searchParameters,
    setSearchParameters,
    severity,
    status,
  ]);

  const updateFilter = useCallback(
    (key: 'severity' | 'issueType' | 'status', value: string) => {
      setSearchParameters((current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        next.delete('page');
        return next;
      });
    },
    [setSearchParameters],
  );

  const changePage = useCallback(
    (nextPage: number) => {
      setSearchParameters((current) => {
        const next = new URLSearchParams(current);
        if (nextPage <= 1) next.delete('page');
        else next.set('page', String(nextPage));
        return next;
      });
    },
    [setSearchParameters],
  );
  const openIssue = useCallback(
    (nextIssueId: string) => {
      setSearchParameters((current) => {
        const next = new URLSearchParams(current);
        next.set('issue', nextIssueId);
        next.delete('recheck');
        return next;
      });
    },
    [setSearchParameters],
  );
  const closeIssue = useCallback(() => {
    setSearchParameters((current) => {
      const next = new URLSearchParams(current);
      next.delete('issue');
      next.delete('recheck');
      return next;
    });
  }, [setSearchParameters]);
  const resetForSnapshot = useCallback(() => {
    setSearchParameters(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('page');
        next.delete('issue');
        next.delete('recheck');
        return next;
      },
      { replace: true },
    );
  }, [setSearchParameters]);
  const consumeRecheck = useCallback(() => {
    setSearchParameters(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('recheck');
        return next;
      },
      { replace: true, state: location.state },
    );
  }, [location.state, setSearchParameters]);

  return {
    page,
    severity,
    issueType,
    status,
    issueId,
    recheck,
    changePage,
    changeSeverity: useCallback((value) => updateFilter('severity', value), [updateFilter]),
    changeIssueType: useCallback((value) => updateFilter('issueType', value), [updateFilter]),
    changeStatus: useCallback((value) => updateFilter('status', value), [updateFilter]),
    openIssue,
    closeIssue,
    resetForSnapshot,
    consumeRecheck,
  };
}
