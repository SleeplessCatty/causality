import type { SemanticModel } from '@causality/contracts';
import { useEffect, useRef } from 'react';

interface ModelSwitchDialogProps {
  model: SemanticModel | null;
  pending: boolean;
  error?: string | undefined;
  onCancel(): void;
  onConfirm(): void;
}

function formatMegabytes(bytes: number): string {
  return `约 ${Math.round(bytes / 1024 / 1024)} MB`;
}

export function ModelSwitchDialog({
  model,
  pending,
  error,
  onCancel,
  onConfirm,
}: ModelSwitchDialogProps) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!model) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelButtonRef.current?.focus();
    return () => previousFocus?.focus();
  }, [model]);

  useEffect(() => {
    if (!model) return;
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
  }, [model, onCancel, pending]);

  if (!model) return null;

  const requiresDownload = model.downloadStatus !== 'downloaded';
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
        aria-labelledby="model-switch-title"
        aria-describedby="model-switch-description"
        tabIndex={-1}
      >
        <h2 id="model-switch-title">确认切换模型</h2>
        <p id="model-switch-description">
          切换后将立即删除当前语义索引。在新模型下载并完成索引前，增强查询暂不可用。
        </p>
        {requiresDownload ? (
          <p className="model-switch-dialog__download">
            {model.label}尚未下载，预计需要下载 {formatMegabytes(model.expectedDownloadBytes)}。
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
            {pending ? '切换中…' : '确认切换'}
          </button>
        </div>
      </div>
    </div>
  );
}
