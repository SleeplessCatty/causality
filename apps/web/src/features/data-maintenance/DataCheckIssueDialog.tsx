import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

import type {
  DataCheckActionOption,
  DataCheckActionRequest,
  DataCheckActionResponse,
} from '@causality/contracts';
import { AppDialog } from '../../shared/dialog/AppDialog';
import { createDataCheckEditReturnState } from '../../shared/navigation/listReturn';
import { OverflowText } from '../../shared/tooltip/OverflowText';
import { applyDataCheckAction, getDataCheckActionContext } from './dataMaintenanceApi';
import { DataCheckMergeDialog } from './DataCheckMergeDialog';

interface DataCheckIssueDialogProps {
  issueId: string;
  snapshotId: string;
  onClose(): void;
}

async function invalidateAffectedData(
  queryClient: ReturnType<typeof useQueryClient>,
  result: DataCheckActionResponse,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['data-checks', 'latest'] }),
    queryClient.invalidateQueries({ queryKey: ['data-checks', 'issues'] }),
    queryClient.invalidateQueries({ queryKey: ['events', 'list'] }),
    queryClient.invalidateQueries({ queryKey: ['events', 'candidates'] }),
    queryClient.invalidateQueries({ queryKey: ['cases', 'list'] }),
    queryClient.invalidateQueries({ queryKey: ['cases', 'candidates'] }),
    queryClient.invalidateQueries({ queryKey: ['relations', 'list'] }),
    queryClient.invalidateQueries({ queryKey: ['relations', 'pair-check'] }),
    queryClient.invalidateQueries({ queryKey: ['causal-graph'] }),
    ...result.affectedEventIds.flatMap((id) => [
      queryClient.invalidateQueries({ queryKey: ['events', 'detail', id] }),
      queryClient.invalidateQueries({ queryKey: ['events', 'relations', id] }),
    ]),
    ...result.affectedCaseIds.flatMap((id) => [
      queryClient.invalidateQueries({ queryKey: ['cases', 'detail', id] }),
      queryClient.invalidateQueries({ queryKey: ['cases', 'relations', id] }),
    ]),
    ...result.affectedRelationIds.flatMap((id) => [
      queryClient.invalidateQueries({ queryKey: ['relations', 'detail', id] }),
      queryClient.invalidateQueries({ queryKey: ['cases', 'relation-associations', id] }),
    ]),
  ]);
}

function requestFor(
  action: DataCheckActionOption,
  snapshotId: string,
): DataCheckActionRequest | null {
  switch (action.type) {
    case 'merge':
      return action.keepId && action.mergeId
        ? { type: 'merge', snapshotId, keepId: action.keepId, mergeId: action.mergeId }
        : null;
    case 'cleanup':
    case 'delete_relation':
    case 'repair_timestamp':
    case 'ignore':
      return { type: action.type, snapshotId };
    case 'open_edit':
      return null;
  }
}

const kindCopy = {
  cleanup: '确认清理检查发现的失效或重复数据。',
  delete_relation: '此操作会删除异常因果关系，请确认后继续。',
  repair_timestamp: '将依据服务器提供的修复方案校正时间字段。',
  edit: '请打开详情编辑并保存更正，返回后会重新检查此问题。',
  ignore_only: '当前问题没有自动修复方案，可忽略或使用服务器提供的安全入口。',
} as const;

function ContextRecords({
  records,
}: {
  records: readonly {
    id: string;
    title: string;
    primaryText: string;
    secondaryText: readonly string[];
    relationCount: number;
    caseCount: number;
  }[];
}) {
  return (
    <div className="data-check-dialog__records">
      {records.map((record) => (
        <article className="data-check-record-card" key={record.id}>
          <h3>{record.title}</h3>
          <OverflowText content={record.primaryText} lines={3} mode="always">
            <p>{record.primaryText}</p>
          </OverflowText>
          {record.secondaryText.map((text, index) => (
            <OverflowText content={text} lines={2} mode="always" key={`${record.id}-${index}`}>
              <span>{text}</span>
            </OverflowText>
          ))}
          <small>
            {record.relationCount} 条关系 · {record.caseCount} 个案例
          </small>
        </article>
      ))}
    </div>
  );
}

export function DataCheckIssueDialog({ issueId, snapshotId, onClose }: DataCheckIssueDialogProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const closeActionRef = useRef<HTMLButtonElement>(null);
  const [selectedMergeAction, setSelectedMergeAction] = useState<DataCheckActionOption | null>(
    null,
  );
  const contextQuery = useQuery({
    queryKey: ['data-checks', 'action-context', issueId, snapshotId],
    queryFn: ({ signal }) => getDataCheckActionContext(issueId, snapshotId, signal),
  });
  const actionMutation = useMutation({
    mutationFn: (action: DataCheckActionOption) => {
      const request = requestFor(action, snapshotId);
      if (!request) throw new Error('服务器操作信息不完整，请重新加载');
      return applyDataCheckAction(issueId, request);
    },
    onSuccess: async (result) => {
      await invalidateAffectedData(queryClient, result);
      onClose();
    },
  });

  const context = contextQuery.data;
  const ignoreAction = context?.actions.find((candidate) => candidate.type === 'ignore') ?? null;
  const regularActions =
    context?.actions.filter(
      (candidate) => candidate.type !== 'ignore' && candidate.type !== 'merge',
    ) ?? [];
  const hasMergeAction = context?.actions.some((candidate) => candidate.type === 'merge') ?? false;
  const initialFocusRef =
    context?.dialogKind === 'merge' && hasMergeAction
      ? undefined
      : regularActions.length > 0
        ? primaryActionRef
        : closeActionRef;

  function run(action: DataCheckActionOption): void {
    if (action.type === 'open_edit') {
      if (!action.editPath) return;
      navigate(action.editPath, {
        state: createDataCheckEditReturnState(location, snapshotId, issueId),
      });
      return;
    }
    actionMutation.mutate(action);
  }

  const pending = actionMutation.isPending;
  return (
    <AppDialog
      open
      title="处理检查问题"
      descriptionId="data-check-dialog-description"
      pending={pending}
      {...(initialFocusRef ? { initialFocusRef } : {})}
      className="data-check-dialog"
      onClose={onClose}
      actions={
        <>
          {context?.dialogKind === 'merge' && hasMergeAction ? (
            <button
              ref={primaryActionRef}
              className="button button--primary"
              type="button"
              disabled={!selectedMergeAction || pending}
              onClick={() => selectedMergeAction && run(selectedMergeAction)}
            >
              {pending ? '处理中…' : '确认处理'}
            </button>
          ) : (
            regularActions.map((candidate, index) => (
              <button
                ref={index === 0 ? primaryActionRef : undefined}
                className="button button--primary"
                type="button"
                disabled={pending}
                onClick={() => run(candidate)}
                key={`${candidate.type}-${candidate.label}`}
              >
                {pending ? '处理中…' : candidate.label}
              </button>
            ))
          )}
          {ignoreAction ? (
            <div className="data-check-dialog__ignore">
              <button
                className="button button--secondary"
                type="button"
                disabled={pending}
                onClick={() => run(ignoreAction)}
              >
                {ignoreAction.label}
              </button>
            </div>
          ) : null}
          <button
            ref={closeActionRef}
            className="button button--secondary"
            type="button"
            disabled={pending}
            onClick={onClose}
          >
            关闭
          </button>
        </>
      }
    >
      {contextQuery.isPending ? (
        <p id="data-check-dialog-description">正在加载当前处理信息…</p>
      ) : null}
      {contextQuery.isError ? (
        <div className="data-check-action-error" role="alert">
          <p id="data-check-dialog-description">
            {contextQuery.error instanceof Error
              ? contextQuery.error.message
              : '处理信息加载失败，请稍后重试'}
          </p>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => void contextQuery.refetch()}
          >
            重新加载
          </button>
        </div>
      ) : null}
      {context ? (
        <>
          <p id="data-check-dialog-description">
            {context.message ??
              (context.dialogKind === 'merge'
                ? '比较两条记录并选择服务器提供的合并方向。'
                : kindCopy[context.dialogKind])}
          </p>
          {context.dialogKind === 'merge' ? (
            <DataCheckMergeDialog
              context={context}
              selectedAction={selectedMergeAction}
              pending={pending}
              onSelect={setSelectedMergeAction}
            />
          ) : (
            <ContextRecords records={context.records} />
          )}
          {context.actions.length === 0 ? (
            <button
              className="button button--secondary"
              type="button"
              onClick={() => void contextQuery.refetch()}
            >
              重新加载
            </button>
          ) : null}
        </>
      ) : null}
      {actionMutation.error ? (
        <div className="data-check-action-error" role="alert">
          {actionMutation.error instanceof Error
            ? actionMutation.error.message
            : '处理失败，请稍后重试'}
        </div>
      ) : null}
    </AppDialog>
  );
}
