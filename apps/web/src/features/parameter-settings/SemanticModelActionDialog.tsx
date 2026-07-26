import type { SemanticModel } from '@causality/contracts';
import { useEffect, useRef } from 'react';

import { formatMegabytes } from './semanticPresentation';

export interface SemanticModelAction {
  type: 'switch' | 'reindex';
  model: SemanticModel;
}

interface SemanticModelActionDialogProps {
  action: SemanticModelAction | null;
  pending: boolean;
  error?: string | undefined;
  onCancel(): void;
  onConfirm(): void;
}

export function SemanticModelActionDialog({
  action,
  pending,
  error,
  onCancel,
  onConfirm,
}: SemanticModelActionDialogProps) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!action) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelButtonRef.current?.focus();
    return () => previousFocus?.focus();
  }, [action]);

  useEffect(() => {
    if (!action) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable =
        dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
      if (!focusable?.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [action, onCancel, pending]);

  if (!action) return null;

  const reindexing = action.type === 'reindex';
  const requiresDownload = !reindexing && action.model.downloadStatus !== 'downloaded';
  const title = reindexing ? '确认重新索引' : '确认切换模型';
  return (
    <div
      className="delete-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="delete-dialog model-switch-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="semantic-action-title"
        aria-describedby="semantic-action-description"
        tabIndex={-1}
      >
        <h2 id="semantic-action-title">{title}</h2>
        <p id="semantic-action-description">
          {reindexing
            ? '重新索引会删除当前语义向量并从头生成，期间增强查询暂不可用；不会删除原子事件、因果关系和具体案例。'
            : '切换后将立即删除当前语义索引。在新模型下载并完成索引前，增强查询暂不可用。'}
        </p>
        {requiresDownload ? (
          <p className="model-switch-dialog__download">
            {action.model.label}尚未下载，预计需要下载{' '}
            {formatMegabytes(action.model.expectedDownloadBytes)}。
          </p>
        ) : null}
        {error ? (
          <div className="form-alert delete-dialog__error" role="alert">
            {error}
          </div>
        ) : null}
        <div className="delete-dialog__actions">
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
            {pending
              ? reindexing
                ? '重新索引中…'
                : '切换中…'
              : reindexing
                ? '确认重新索引'
                : '确认切换'}
          </button>
        </div>
      </div>
    </div>
  );
}
