import type {
  EventCandidate,
  ExportDirection,
  ExportPreviewInput,
  ExportPreviewResponse,
} from '@causality/contracts';
import { useRef, useState } from 'react';

import { AppSelect } from '../../../shared/controls/AppSelect';
import { useAutoDismissError } from '../../../shared/forms/useAutoDismissError';
import { downloadExport, previewExport } from '../dataTransferApi';
import { ExportConfirmDialog } from './ExportConfirmDialog';
import { ExportEventSelector } from './ExportEventSelector';

type ExportMode = ExportPreviewInput['type'];

const directionOptions = [
  { value: 'both', label: '双向' },
  { value: 'downstream', label: '下游' },
  { value: 'upstream', label: '上游' },
] as const;

const depthOptions = Array.from({ length: 10 }, (_, index) => ({
  value: index + 1,
  label: String(index + 1),
}));

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function ExportPanel() {
  const [mode, setMode] = useState<ExportMode>('full');
  const [selectedEvents, setSelectedEvents] = useState<EventCandidate[]>([]);
  const [direction, setDirection] = useState<ExportDirection>('both');
  const [depth, setDepth] = useState(1);
  const [preview, setPreview] = useState<ExportPreviewResponse | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [previewPending, setPreviewPending] = useState(false);
  const [downloadPending, setDownloadPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorRevision, setErrorRevision] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const filterRevisionRef = useRef(0);

  useAutoDismissError(Boolean(error), errorRevision, () => setError(null));

  function invalidatePreview(): void {
    filterRevisionRef.current += 1;
    setPreview(null);
    setDialogOpen(false);
    setNotice(null);
  }

  function changeMode(nextMode: ExportMode): void {
    if (nextMode === mode) return;
    setMode(nextMode);
    invalidatePreview();
    setError(null);
  }

  function showError(message: string): void {
    setError(message);
    setErrorRevision((revision) => revision + 1);
  }

  async function openPreview(): Promise<void> {
    if (preview) {
      setDialogOpen(true);
      return;
    }
    if (previewPending || (mode === 'filtered' && selectedEvents.length === 0)) return;

    const input: ExportPreviewInput =
      mode === 'full'
        ? { type: 'full' }
        : {
            type: 'filtered',
            startEventIds: selectedEvents.map((event) => event.id),
            direction,
            depth,
          };
    setPreviewPending(true);
    setError(null);
    setNotice(null);
    const filterRevision = filterRevisionRef.current;
    try {
      const nextPreview = await previewExport(input);
      if (filterRevision !== filterRevisionRef.current) return;
      setPreview(nextPreview);
      setDialogOpen(true);
    } catch (previewError) {
      if (filterRevision === filterRevisionRef.current) {
        showError(errorMessage(previewError, '无法预览导出，请重试'));
      }
    } finally {
      setPreviewPending(false);
    }
  }

  async function confirmDownload(): Promise<void> {
    if (!preview || downloadPending) return;
    setDownloadPending(true);
    setError(null);
    try {
      await downloadExport(preview.token);
      setDialogOpen(false);
      setNotice('下载已开始');
    } catch (availabilityError) {
      setPreview(null);
      setDialogOpen(false);
      showError(`${errorMessage(availabilityError, '无法确认导出可用性')}，请重新预览`);
    } finally {
      setDownloadPending(false);
    }
  }

  const previewDisabled = previewPending || (mode === 'filtered' && selectedEvents.length === 0);

  return (
    <section className="data-transfer-export-card" aria-labelledby="export-panel-title">
      <div className="data-transfer-section-heading">
        <div>
          <h2 id="export-panel-title">导出 CSV</h2>
          <p>完整导出全部数据，或按因果图范围筛选导出。</p>
        </div>
      </div>

      <div className="data-transfer-export-mode" aria-label="导出范围">
        <button
          className={`button ${mode === 'full' ? 'button--primary' : 'button--secondary'}`}
          type="button"
          aria-pressed={mode === 'full'}
          onClick={() => changeMode('full')}
        >
          完整导出
        </button>
        <button
          className={`button ${mode === 'filtered' ? 'button--primary' : 'button--secondary'}`}
          type="button"
          aria-pressed={mode === 'filtered'}
          onClick={() => changeMode('filtered')}
        >
          筛选导出
        </button>
      </div>

      {mode === 'filtered' ? (
        <div className="data-transfer-export-filter">
          <ExportEventSelector
            selected={selectedEvents}
            onChange={(events) => {
              setSelectedEvents(events);
              invalidatePreview();
            }}
          />
          <div className="data-transfer-export-selects">
            <AppSelect
              label="方向"
              ariaLabel="遍历方向"
              value={direction}
              options={directionOptions}
              onChange={(value) => {
                if (value === direction) return;
                setDirection(value);
                invalidatePreview();
              }}
            />
            <AppSelect
              label="深度"
              ariaLabel="遍历深度"
              value={depth}
              options={depthOptions}
              onChange={(value) => {
                if (value === depth) return;
                setDepth(value);
                invalidatePreview();
              }}
            />
          </div>
        </div>
      ) : null}

      <div className="data-transfer-export-actions">
        <button
          className="button button--primary"
          type="button"
          disabled={previewDisabled}
          onClick={() => void openPreview()}
        >
          {previewPending
            ? '正在预览…'
            : preview
              ? '查看导出确认'
              : error?.includes('重新预览')
                ? '重新预览'
                : '预览并导出'}
        </button>
      </div>

      {error ? (
        <div className="form-alert data-transfer-export-message" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="data-transfer-export-message data-transfer-export-success" role="status">
          {notice}
        </div>
      ) : null}

      <ExportConfirmDialog
        open={dialogOpen}
        preview={preview}
        pending={downloadPending}
        onClose={() => {
          if (!downloadPending) setDialogOpen(false);
        }}
        onConfirm={() => void confirmDownload()}
      />
    </section>
  );
}
