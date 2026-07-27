import type {
  EventCandidate,
  ExportDirection,
  ExportPreviewInput,
  ExportPreviewResponse,
} from '@causality/contracts';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

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

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

interface PreviewMutationVariables {
  input: ExportPreviewInput;
  signal: AbortSignal;
  filterRevision: number;
}

interface DownloadMutationVariables {
  token: string;
  signal: AbortSignal;
  filterRevision: number;
}

export function ExportPanel() {
  const [mode, setMode] = useState<ExportMode>('full');
  const [selectedEvents, setSelectedEvents] = useState<EventCandidate[]>([]);
  const [direction, setDirection] = useState<ExportDirection>('both');
  const [depth, setDepth] = useState(1);
  const [preview, setPreview] = useState<ExportPreviewResponse | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [errorRevision, setErrorRevision] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const filterRevisionRef = useRef(0);
  const previewAbortControllerRef = useRef<AbortController | null>(null);
  const downloadAbortControllerRef = useRef<AbortController | null>(null);

  const previewMutation = useMutation<ExportPreviewResponse, unknown, PreviewMutationVariables>({
    mutationFn: ({ input, signal }) => previewExport(input, signal),
    onSuccess: (nextPreview, variables) => {
      if (variables.signal.aborted || variables.filterRevision !== filterRevisionRef.current) {
        return;
      }
      setPreview(nextPreview);
      setDialogOpen(true);
    },
    onError: (previewError, variables) => {
      if (
        isAbortError(previewError) ||
        variables.signal.aborted ||
        variables.filterRevision !== filterRevisionRef.current
      ) {
        return;
      }
      setErrorRevision((revision) => revision + 1);
    },
    onSettled: (_data, _error, variables) => {
      if (previewAbortControllerRef.current?.signal === variables.signal) {
        previewAbortControllerRef.current = null;
      }
    },
  });

  const downloadMutation = useMutation<void, unknown, DownloadMutationVariables>({
    mutationFn: ({ token, signal }) => downloadExport(token, signal),
    onSuccess: (_data, variables) => {
      if (variables.signal.aborted || variables.filterRevision !== filterRevisionRef.current) {
        return;
      }
      setDialogOpen(false);
      setNotice('下载已开始');
    },
    onError: (availabilityError, variables) => {
      if (
        isAbortError(availabilityError) ||
        variables.signal.aborted ||
        variables.filterRevision !== filterRevisionRef.current
      ) {
        return;
      }
      setPreview(null);
      setDialogOpen(false);
      setErrorRevision((revision) => revision + 1);
    },
    onSettled: (_data, _error, variables) => {
      if (downloadAbortControllerRef.current?.signal === variables.signal) {
        downloadAbortControllerRef.current = null;
      }
    },
  });

  useEffect(
    () => () => {
      filterRevisionRef.current += 1;
      previewAbortControllerRef.current?.abort();
      downloadAbortControllerRef.current?.abort();
    },
    [],
  );

  const previewError =
    previewMutation.isError && !isAbortError(previewMutation.error)
      ? errorMessage(previewMutation.error, '无法预览导出，请重试')
      : null;
  const availabilityError =
    downloadMutation.isError && !isAbortError(downloadMutation.error)
      ? `${errorMessage(downloadMutation.error, '无法确认导出可用性')}，请重新预览`
      : null;
  const error = availabilityError ?? previewError;

  useAutoDismissError(Boolean(error), errorRevision, () => {
    previewMutation.reset();
    downloadMutation.reset();
  });

  function invalidatePreview(): void {
    filterRevisionRef.current += 1;
    previewAbortControllerRef.current?.abort();
    previewAbortControllerRef.current = null;
    downloadAbortControllerRef.current?.abort();
    downloadAbortControllerRef.current = null;
    previewMutation.reset();
    downloadMutation.reset();
    setPreview(null);
    setDialogOpen(false);
    setNotice(null);
  }

  function changeMode(nextMode: ExportMode): void {
    if (nextMode === mode) return;
    setMode(nextMode);
    invalidatePreview();
  }

  function openPreview(): void {
    if (preview) {
      setDialogOpen(true);
      return;
    }
    if (previewMutation.isPending || (mode === 'filtered' && selectedEvents.length === 0)) {
      return;
    }

    const input: ExportPreviewInput =
      mode === 'full'
        ? { type: 'full' }
        : {
            type: 'filtered',
            startEventIds: selectedEvents.map((event) => event.id),
            direction,
            depth,
          };
    setNotice(null);
    downloadMutation.reset();
    const controller = new AbortController();
    previewAbortControllerRef.current = controller;
    previewMutation.mutate({
      input,
      signal: controller.signal,
      filterRevision: filterRevisionRef.current,
    });
  }

  function confirmDownload(): void {
    if (!preview || downloadMutation.isPending) return;
    setNotice(null);
    previewMutation.reset();
    const controller = new AbortController();
    downloadAbortControllerRef.current = controller;
    downloadMutation.mutate({
      token: preview.token,
      signal: controller.signal,
      filterRevision: filterRevisionRef.current,
    });
  }

  const previewDisabled =
    previewMutation.isPending || (mode === 'filtered' && selectedEvents.length === 0);

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
          onClick={openPreview}
        >
          {previewMutation.isPending
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
        pending={downloadMutation.isPending}
        onClose={() => {
          if (!downloadMutation.isPending) setDialogOpen(false);
        }}
        onConfirm={confirmDownload}
      />
    </section>
  );
}
