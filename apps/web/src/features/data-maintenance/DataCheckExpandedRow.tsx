import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import type { DataCheckActionOption, DataCheckIssueListItem } from '@causality/contracts';
import { DataCheckActionError } from './DataCheckActionError';
import { DataCheckActionPlan, DataCheckPanelActions } from './DataCheckActionPlan';
import { DataCheckIssueSummary } from './DataCheckIssueSummary';
import { DataCheckMergePlan } from './DataCheckMergePlan';
import { getDataCheckActionContext } from './dataMaintenanceApi';
import { isStaleDataCheckActionError, useDataCheckIssueAction } from './useDataCheckIssueAction';

interface DataCheckExpandedRowProps {
  issue: DataCheckIssueListItem;
  snapshotId: string;
  onHandled(): void;
}

export function DataCheckExpandedRow({ issue, snapshotId, onHandled }: DataCheckExpandedRowProps) {
  const [selectedMergeAction, setSelectedMergeAction] = useState<DataCheckActionOption | null>(
    null,
  );
  const contextQuery = useQuery({
    queryKey: ['data-checks', 'action-context', issue.id, snapshotId],
    queryFn: ({ signal }) => getDataCheckActionContext(issue.id, snapshotId, signal),
  });
  const mutation = useDataCheckIssueAction({
    issueId: issue.id,
    snapshotId,
    onSuccess: onHandled,
  });
  const context = contextQuery.data;
  const ignoreAction = context?.actions.find((candidate) => candidate.type === 'ignore') ?? null;
  const fixedAction =
    context?.actions.find(
      (candidate) => candidate.type !== 'ignore' && candidate.type !== 'merge',
    ) ?? null;
  const hasMergeAction = context?.actions.some((candidate) => candidate.type === 'merge') ?? false;
  const confirmAction = context?.panelKind === 'merge' ? selectedMergeAction : fixedAction;
  const contextStale = Boolean(context && (context.actions.length === 0 || context.message));
  const disabled = contextStale || mutation.stale;

  return (
    <div
      className="data-check-expanded"
      data-testid={`expanded-${issue.id}`}
      data-snapshot-id={snapshotId}
      aria-live="polite"
    >
      <DataCheckIssueSummary description={issue.description} suggestion={issue.suggestion} />
      {contextQuery.isPending ? (
        <div className="data-check-action-loading" role="status">
          正在加载处理方案…
        </div>
      ) : null}
      {contextQuery.isError ? (
        <DataCheckActionError
          message={
            contextQuery.error instanceof Error
              ? contextQuery.error.message
              : '处理方案加载失败，请稍后重试'
          }
          stale={isStaleDataCheckActionError(contextQuery.error)}
          onRetry={() => void contextQuery.refetch()}
        />
      ) : null}
      {context ? (
        <>
          {context.panelKind === 'merge' && hasMergeAction ? (
            <DataCheckMergePlan
              context={context}
              selectedAction={selectedMergeAction}
              disabled={disabled || mutation.pending}
              onSelect={setSelectedMergeAction}
            />
          ) : fixedAction ? (
            <DataCheckActionPlan action={fixedAction} />
          ) : null}
          {contextStale ? (
            <DataCheckActionError message={context.message ?? '当前问题已发生变化。'} stale />
          ) : null}
          {mutation.error ? (
            <DataCheckActionError message={mutation.error} stale={mutation.stale} />
          ) : null}
          <DataCheckPanelActions
            showConfirm={hasMergeAction || fixedAction !== null}
            confirmAction={confirmAction}
            ignoreAction={ignoreAction}
            pending={mutation.pending}
            disabled={disabled}
            onApply={mutation.apply}
          />
        </>
      ) : null}
    </div>
  );
}
