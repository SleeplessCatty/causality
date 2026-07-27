import type { SemanticAction, SemanticModelLifecycle } from '@causality/contracts';
import { useRef } from 'react';

import { AppDialog } from '../../shared/dialog/AppDialog';
import { formatApproximateMegabytes, semanticActionLabel } from './semanticPresentation';

export interface SemanticModelAction {
  type: SemanticAction;
  model: SemanticModelLifecycle;
}

interface SemanticModelActionDialogProps {
  action: SemanticModelAction | null;
  pending: boolean;
  error?: string | undefined;
  onCancel(): void;
  onConfirm(): void;
}

function dialogCopy(action: SemanticModelAction): {
  title: string;
  confirmLabel: string;
  description: string;
} {
  if (action.type === 'use') {
    return {
      title: '确认切换模型',
      confirmLabel: '确认切换',
      description: '切换后将立即删除当前语义索引。在新模型加载并完成索引前，增强查询暂不可用。',
    };
  }
  if (action.type === 'reindex') {
    return {
      title: '确认重新索引',
      confirmLabel: '确认重新索引',
      description:
        '重新索引会删除当前语义向量并从头生成，期间增强查询暂不可用；不会删除原子事件、因果关系和具体案例。',
    };
  }

  const label = semanticActionLabel(action.type);
  const descriptions: Record<Exclude<SemanticAction, 'use' | 'reindex'>, string> = {
    download_and_use: '模型下载完成后会自动加载，并为当前业务数据生成完整语义索引。',
    retry_download: '系统将重新尝试下载当前模型，并在成功后继续加载和索引。',
    redownload_and_use: '系统会清理失效的模型文件，重新下载后自动加载并生成索引。',
    retry_load: '请先确认运行环境和可用内存已经满足要求，再重新尝试加载当前模型。',
    retry_full_index: '系统将重新执行当前模型的全量索引任务。',
  };
  return {
    title: `确认${label}`,
    confirmLabel: `确认${label}`,
    description: descriptions[action.type],
  };
}

export function SemanticModelActionDialog({
  action,
  pending,
  error,
  onCancel,
  onConfirm,
}: SemanticModelActionDialogProps) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const copy = action ? dialogCopy(action) : null;
  const requiresDownload =
    action?.type === 'download_and_use' || action?.type === 'redownload_and_use';

  return (
    <AppDialog
      open={action !== null}
      title={copy?.title ?? ''}
      descriptionId="semantic-action-description"
      pending={pending}
      initialFocusRef={cancelButtonRef}
      className="model-switch-dialog"
      onClose={onCancel}
      actions={
        action ? (
          <>
            <button
              ref={cancelButtonRef}
              className="button button--secondary"
              type="button"
              disabled={pending}
              onClick={onCancel}
            >
              取消
            </button>
            <button
              className="button button--primary"
              type="button"
              disabled={pending}
              onClick={onConfirm}
            >
              {pending ? `${semanticActionLabel(action.type)}中…` : copy?.confirmLabel}
            </button>
          </>
        ) : null
      }
    >
      {action && copy ? (
        <>
          <p id="semantic-action-description">{copy.description}</p>
          {requiresDownload ? (
            <p className="model-switch-dialog__download">
              {action.model.label}预计需要下载{' '}
              {formatApproximateMegabytes(action.model.expectedDownloadBytes)}。
            </p>
          ) : null}
          {error ? (
            <div className="form-alert delete-dialog__error" role="alert">
              {error}
            </div>
          ) : null}
        </>
      ) : null}
    </AppDialog>
  );
}
