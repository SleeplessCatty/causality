import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';

import { getReadiness } from '../system-status/systemStatusApi';
import { DataCheckIssueDialog } from './DataCheckIssueDialog';
import { DataCheckPanel } from './DataCheckPanel';
import { getLatestDataCheck, recheckDataCheckIssue, startDataCheck } from './dataMaintenanceApi';
import { useDataCheckQueryState } from './useDataCheckQueryState';

export function DataMaintenance() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const queryState = useDataCheckQueryState();
  const previousSnapshotId = useRef<string | null>(null);
  const consumedRecheck = useRef<string | null>(null);
  const readiness = useQuery({
    queryKey: ['system', 'readiness'],
    queryFn: ({ signal }) => getReadiness(signal),
  });
  const dataCheck = useQuery({
    queryKey: ['data-checks', 'latest'],
    queryFn: ({ signal }) => getLatestDataCheck(signal),
    refetchInterval: (query) => (query.state.data?.task.status === 'running' ? 250 : false),
  });
  const startCheck = useMutation({
    mutationFn: startDataCheck,
    onSuccess: (latest) => {
      queryClient.setQueryData(['data-checks', 'latest'], latest);
    },
  });
  const recheckIssue = useMutation({
    mutationFn: ({ issueId, snapshotId }: { issueId: string; snapshotId: string }) =>
      recheckDataCheckIssue(issueId, snapshotId),
    onSuccess: async (result) => {
      if (result.status === 'open') {
        queryClient.setQueryData(
          ['data-checks', 'action-context', result.issue.id, result.issue.snapshotId],
          result.context,
        );
      } else {
        queryState.closeIssue();
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['data-checks', 'latest'] }),
        queryClient.invalidateQueries({ queryKey: ['data-checks', 'issues'] }),
      ]);
    },
  });

  const isChecking =
    readiness.isFetching || startCheck.isPending || dataCheck.data?.task.status === 'running';

  async function checkData(): Promise<void> {
    const refreshedReadiness = await readiness.refetch();
    if (refreshedReadiness.data?.status !== 'ready') return;
    await startCheck.mutateAsync();
  }

  const readinessError =
    !readiness.isPending && readiness.data?.status !== 'ready'
      ? '数据库不可用，无法执行检查'
      : null;

  const snapshotId = dataCheck.data?.snapshot?.snapshotId ?? null;
  useEffect(() => {
    if (!snapshotId) return;
    if (previousSnapshotId.current && previousSnapshotId.current !== snapshotId) {
      queryState.resetForSnapshot();
    }
    previousSnapshotId.current = snapshotId;
  }, [queryState.resetForSnapshot, snapshotId]);

  useEffect(() => {
    if (!queryState.recheck || !queryState.issueId || !snapshotId) return;
    const state =
      typeof location.state === 'object' && location.state !== null
        ? (location.state as Record<string, unknown>)
        : null;
    if (
      state?.dataCheckReturnMode !== 'saved' ||
      state.dataCheckIssueId !== queryState.issueId ||
      state.dataCheckSnapshotId !== snapshotId
    ) {
      queryState.consumeRecheck();
      return;
    }
    const marker = `${snapshotId}:${queryState.issueId}:${location.key}`;
    if (consumedRecheck.current === marker) return;
    consumedRecheck.current = marker;
    queryState.consumeRecheck();
    recheckIssue.mutate({ issueId: queryState.issueId, snapshotId });
  }, [
    location.key,
    location.state,
    queryState.consumeRecheck,
    queryState.issueId,
    queryState.recheck,
    recheckIssue,
    snapshotId,
  ]);

  return (
    <div className="data-maintenance-workspace">
      <div className="page-heading">
        <div>
          <h1>数据维护</h1>
          <p>检查数据质量问题并建议处理方案</p>
        </div>
      </div>
      <DataCheckPanel
        latest={dataCheck.data}
        loading={dataCheck.isPending}
        checking={isChecking}
        queryState={queryState}
        onCheck={() => void checkData()}
        error={
          startCheck.error instanceof Error
            ? startCheck.error.message
            : recheckIssue.error instanceof Error
              ? recheckIssue.error.message
              : dataCheck.error instanceof Error
                ? dataCheck.error.message
                : readinessError
        }
      />
      {queryState.issueId && snapshotId ? (
        <DataCheckIssueDialog
          key={queryState.issueId}
          issueId={queryState.issueId}
          snapshotId={snapshotId}
          onClose={queryState.closeIssue}
        />
      ) : null}
    </div>
  );
}
