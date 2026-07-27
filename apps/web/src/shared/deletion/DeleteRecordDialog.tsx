import { useRef } from 'react';
import { Link } from 'react-router';

import { AppDialog } from '../dialog/AppDialog';

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

  return (
    <AppDialog
      open={open}
      title={title}
      descriptionId="delete-dialog-message"
      pending={pending}
      initialFocusRef={cancelButtonRef}
      onClose={onCancel}
      actions={
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
        </>
      }
    >
      <p id="delete-dialog-message">{message}</p>
      {error ? (
        <div className="form-alert delete-dialog__error" role="alert">
          {error}
        </div>
      ) : null}
    </AppDialog>
  );
}
