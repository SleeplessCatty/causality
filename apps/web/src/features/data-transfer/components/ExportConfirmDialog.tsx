import type { ExportPreparationResponse as ExportConfirmation } from '@causality/contracts';

import { AppDialog } from '../../../shared/dialog/AppDialog';

interface ExportConfirmDialogProps {
  open: boolean;
  confirmation: ExportConfirmation | null;
  pending: boolean;
  onClose(): void;
  onConfirm(): void;
}

export function ExportConfirmDialog({
  open,
  confirmation,
  pending,
  onClose,
  onConfirm,
}: ExportConfirmDialogProps) {
  return (
    <AppDialog
      open={open && confirmation !== null}
      title="确认导出"
      descriptionId="export-confirm-description"
      pending={pending}
      className="data-transfer-export-dialog"
      onClose={onClose}
      actions={
        <>
          <button
            className="button button--secondary"
            type="button"
            disabled={pending}
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="button button--primary"
            type="button"
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? '正在导出…' : '导出'}
          </button>
        </>
      }
    >
      {confirmation ? (
        <>
          <p id="export-confirm-description">本次将导出以下数据，请确认是否继续。</p>
          <dl className="data-transfer-export-counts">
            <div>
              <dt>原子事件</dt>
              <dd>{confirmation.counts.events}</dd>
            </div>
            <div>
              <dt>因果关系</dt>
              <dd>{confirmation.counts.relations}</dd>
            </div>
            <div>
              <dt>具体案例</dt>
              <dd>{confirmation.counts.cases}</dd>
            </div>
          </dl>
        </>
      ) : null}
    </AppDialog>
  );
}
