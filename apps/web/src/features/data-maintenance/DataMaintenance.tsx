import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { LoadingHeadingStatus, LoadingState } from '../../shared/loading/LoadingState';
import { getReadiness } from '../system-status/systemStatusApi';
import { DataCheckPanel } from './DataCheckPanel';
import { getLatestDataCheck, startDataCheck } from './dataMaintenanceApi';
import { useDataCheckQueryState } from './useDataCheckQueryState';

export function DataMaintenance() {
  const queryClient = useQueryClient();
  const queryState = useDataCheckQueryState();
  const previousSnapshotId = useRef<string | null>(null);
  const readiness = useQuery({
    queryKey: ['system', 'readiness'],
    queryFn: ({ signal }) => getReadiness(signal),
    staleTime: 0,
  });
  const dataCheck = useQuery({
    queryKey: ['data-checks', 'latest'],
    queryFn: ({ signal }) => getLatestDataCheck(signal),
    refetchInterval: (query) => (query.state.data?.task.status === 'running' ? 250 : false),
    staleTime: 0,
  });
  const startCheck = useMutation({
    mutationFn: startDataCheck,
    onSuccess: (latest) => {
      queryClient.setQueryData(['data-checks', 'latest'], latest);
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
  const latestSnapshotFresh = dataCheck.isSuccess && dataCheck.isFetchedAfterMount;

  useEffect(() => {
    if (!snapshotId || !latestSnapshotFresh) return;
    if (previousSnapshotId.current && previousSnapshotId.current !== snapshotId) {
      queryState.resetForSnapshot();
    }
    previousSnapshotId.current = snapshotId;
  }, [latestSnapshotFresh, queryState.resetForSnapshot, snapshotId]);

  return (
    <div className="data-maintenance-workspace">
      <div className="page-heading">
        <div>
          <h1>数据维护</h1>
          <p>检查数据质量问题并建议处理方案</p>
        </div>
        <LoadingHeadingStatus
          fetching={
            (readiness.isFetching && !readiness.isPending) ||
            (dataCheck.isFetching && !dataCheck.isPending)
          }
          error={readiness.error ?? dataCheck.error}
          onRetry={() => void Promise.all([readiness.refetch(), dataCheck.refetch()])}
        />
      </div>
      <LoadingState
        pending={dataCheck.isPending}
        fetching={dataCheck.isFetching}
        hasData={Boolean(dataCheck.data)}
        error={dataCheck.error}
        skeleton="settings"
        onRetry={() => void dataCheck.refetch()}
      >
        {dataCheck.data ? (
          <DataCheckPanel
            latest={dataCheck.data}
            loading={false}
            checking={isChecking}
            queryState={queryState}
            onCheck={() => void checkData()}
            error={startCheck.error instanceof Error ? startCheck.error.message : readinessError}
          />
        ) : null}
      </LoadingState>
    </div>
  );
}
