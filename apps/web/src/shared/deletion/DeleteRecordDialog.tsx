import { useEffect, useRef } from 'react';
import { Link } from 'react-router';

export interface DeleteRecordDialogProps {
  open: boolean;
  title: string;
  message: string;
  blocked: boolean;
  pending: boolean;
  error: string | null;
  onCancel(): void;
  onConfirm(): void;
  blockedAction?: { label: string; href: string };
}

export function DeleteRecordDialog({
  open,
  title,
  message,
  blocked,
  pending,
  error,
  onCancel,
  onConfirm,
  blockedAction,
}: DeleteRecordDialogProps) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), [tabindex]:not([tabindex="-1"])',
      );
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
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [onCancel, open, pending]);

  if (!open) return null;

  return (
    <div
      className="delete-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="delete-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-dialog-title"
        aria-describedby="delete-dialog-message"
      >
        <h2 id="delete-dialog-title">{title}</h2>
        <p id="delete-dialog-message">{message}</p>
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
          {blockedAction ? (
            <Link className="button button--secondary" to={blockedAction.href}>
              {blockedAction.label}
            </Link>
          ) : null}
          {!blocked ? (
            <button
              className="button button--danger"
              type="button"
              disabled={pending}
              onClick={onConfirm}
            >
              {pending ? '删除中…' : '确认删除'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
