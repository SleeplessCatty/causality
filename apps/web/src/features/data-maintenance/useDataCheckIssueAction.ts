import { useMutation, useQueryClient } from '@tanstack/react-query';

import type {
  DataCheckActionOption,
  DataCheckActionRequest,
  DataCheckActionResponse,
} from '@causality/contracts';
import { ApiClientError } from '../../shared/api/httpClient';
import { applyDataCheckAction } from './dataMaintenanceApi';

interface UseDataCheckIssueActionOptions {
  issueId: string;
  snapshotId: string;
  onSuccess(): void;
}

const staleErrorCodes = new Set([
  'DATA_CHECK_ISSUE_NOT_FOUND',
  'DATA_CHECK_ISSUE_STALE',
  'DATA_CHECK_AUTO_HANDLE_UNSAFE',
  'DATA_CHECK_ACTION_NOT_ALLOWED',
  'DATA_CHECK_ACTION_CONFLICT',
]);

function requestFor(
  action: DataCheckActionOption,
  snapshotId: string,
): DataCheckActionRequest {
  if (action.type === 'ignore') return { type: 'ignore', snapshotId };
  if (!action.actionKey) throw new Error('处理方案信息不完整，请重新执行数据检查');
  if (action.type === 'merge') {
    if (!action.keepId || !action.mergeId) {
      throw new Error('合并方向信息不完整，请重新执行数据检查');
    }
    return {
      type: 'merge',
      snapshotId,
      keepId: action.keepId,
      mergeId: action.mergeId,
      actionKey: action.actionKey,
    };
  }
  return { type: action.type, snapshotId, actionKey: action.actionKey };
}

async function invalidateAffectedData(
  queryClient: ReturnType<typeof useQueryClient>,
  result: DataCheckActionResponse,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['data-checks', 'latest'] }),
    queryClient.invalidateQueries({ queryKey: ['data-checks', 'issues'] }),
    queryClient.invalidateQueries({ queryKey: ['events'] }),
    queryClient.invalidateQueries({ queryKey: ['cases'] }),
    queryClient.invalidateQueries({ queryKey: ['relations'] }),
    queryClient.invalidateQueries({ queryKey: ['causal-graph'] }),
    ...result.affectedEventIds.flatMap((id) => [
      queryClient.invalidateQueries({ queryKey: ['events', 'detail', id] }),
      queryClient.invalidateQueries({ queryKey: ['events', 'relations', id] }),
    ]),
    ...result.affectedCaseIds.flatMap((id) => [
      queryClient.invalidateQueries({ queryKey: ['cases', 'detail', id] }),
      queryClient.invalidateQueries({ queryKey: ['cases', 'relations', id] }),
    ]),
    ...result.affectedRelationIds.map((id) =>
      queryClient.invalidateQueries({ queryKey: ['relations', 'detail', id] }),
    ),
  ]);
}

export function isStaleDataCheckActionError(error: unknown): boolean {
  return error instanceof ApiClientError && staleErrorCodes.has(error.details.code);
}

export function useDataCheckIssueAction({
  issueId,
  snapshotId,
  onSuccess,
}: UseDataCheckIssueActionOptions) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationKey: ['data-checks', 'issue-action'],
    mutationFn: (action: DataCheckActionOption) =>
      applyDataCheckAction(issueId, requestFor(action, snapshotId)),
    onSuccess: async (result) => {
      await invalidateAffectedData(queryClient, result);
      onSuccess();
    },
  });

  return {
    pending: mutation.isPending,
    error: mutation.error instanceof Error ? mutation.error.message : null,
    stale: isStaleDataCheckActionError(mutation.error),
    apply(action: DataCheckActionOption): void {
      mutation.reset();
      mutation.mutate(action);
    },
  };
}
