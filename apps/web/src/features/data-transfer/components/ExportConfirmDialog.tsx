import type { ExportPreviewResponse } from '@causality/contracts';

import { AppDialog } from '../../../shared/dialog/AppDialog';

interface ExportConfirmDialogProps {
  open: boolean;
  preview: ExportPreviewResponse | null;
  pending: boolean;
  onClose(): void;
  onConfirm(): void;
}

export function ExportConfirmDialog({
  open,
  preview,
  pending,
  onClose,
  onConfirm,
}: ExportConfirmDialogProps) {
  return (
    <AppDialog
      open={open && preview !== null}
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
            {pending ? '正在确认可用性…' : '确认下载'}
          </button>
        </>
      }
    >
      {preview ? (
        <>
          <p id="export-confirm-description">请确认本次导出的数据范围。</p>
          <dl className="data-transfer-export-counts">
            <div>
              <dt>原子事件</dt>
              <dd>{preview.counts.events}</dd>
            </div>
            <div>
              <dt>因果关系</dt>
              <dd>{preview.counts.relations}</dd>
            </div>
            <div>
              <dt>具体案例</dt>
              <dd>{preview.counts.cases}</dd>
            </div>
          </dl>
        </>
      ) : null}
    </AppDialog>
  );
}
