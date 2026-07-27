import type {
  EventCandidate,
  ExportDirection,
  ExportPreparationInput as ExportRequestInput,
  ExportPreparationResponse as ExportConfirmation,
} from '@causality/contracts';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { AppSelect } from '../../../shared/controls/AppSelect';
import { useAutoDismissError } from '../../../shared/forms/useAutoDismissError';
import { prepareExport, saveExportFile } from '../dataTransferApi';
import { ExportConfirmDialog } from './ExportConfirmDialog';
import { ExportEventSelector } from './ExportEventSelector';

type ExportMode = ExportRequestInput['type'];

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

interface PrepareMutationVariables {
  input: ExportRequestInput;
  signal: AbortSignal;
  filterRevision: number;
}

interface SaveMutationVariables {
  token: string;
  signal: AbortSignal;
  filterRevision: number;
}

export function ExportPanel() {
  const [mode, setMode] = useState<ExportMode>('full');
  const [selectedEvents, setSelectedEvents] = useState<EventCandidate[]>([]);
  const [direction, setDirection] = useState<ExportDirection>('both');
  const [depth, setDepth] = useState(1);
  const [confirmation, setConfirmation] = useState<ExportConfirmation | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [errorRevision, setErrorRevision] = useState(0);
  const filterRevisionRef = useRef(0);
  const prepareAbortControllerRef = useRef<AbortController | null>(null);
  const saveAbortControllerRef = useRef<AbortController | null>(null);

  const prepareMutation = useMutation<ExportConfirmation, unknown, PrepareMutationVariables>({
    mutationFn: ({ input, signal }) => prepareExport(input, signal),
    onSuccess: (nextConfirmation, variables) => {
      if (variables.signal.aborted || variables.filterRevision !== filterRevisionRef.current) {
        return;
      }
      setConfirmation(nextConfirmation);
      setDialogOpen(true);
    },
    onError: (prepareError, variables) => {
      if (
        isAbortError(prepareError) ||
        variables.signal.aborted ||
        variables.filterRevision !== filterRevisionRef.current
      ) {
        return;
      }
      setErrorRevision((revision) => revision + 1);
    },
    onSettled: (_data, _error, variables) => {
      if (prepareAbortControllerRef.current?.signal === variables.signal) {
        prepareAbortControllerRef.current = null;
      }
    },
  });

  const saveMutation = useMutation<void, unknown, SaveMutationVariables>({
    mutationFn: ({ token, signal }) => saveExportFile(token, signal),
    onSuccess: (_data, variables) => {
      if (variables.signal.aborted || variables.filterRevision !== filterRevisionRef.current) {
        return;
      }
      setDialogOpen(false);
      setConfirmation(null);
    },
    onError: (saveError, variables) => {
      if (
        isAbortError(saveError) ||
        variables.signal.aborted ||
        variables.filterRevision !== filterRevisionRef.current
      ) {
        return;
      }
      setConfirmation(null);
      setDialogOpen(false);
      setErrorRevision((revision) => revision + 1);
    },
    onSettled: (_data, _error, variables) => {
      if (saveAbortControllerRef.current?.signal === variables.signal) {
        saveAbortControllerRef.current = null;
      }
    },
  });

  useEffect(
    () => () => {
      filterRevisionRef.current += 1;
      prepareAbortControllerRef.current?.abort();
      saveAbortControllerRef.current?.abort();
    },
    [],
  );

  const prepareError =
    prepareMutation.isError && !isAbortError(prepareMutation.error)
      ? errorMessage(prepareMutation.error, '无法统计导出数据，请重试')
      : null;
  const saveError =
    saveMutation.isError && !isAbortError(saveMutation.error)
      ? `${errorMessage(saveMutation.error, '无法导出数据')}，请重新发起导出`
      : null;
  const error = saveError ?? prepareError;

  useAutoDismissError(Boolean(error), errorRevision, () => {
    prepareMutation.reset();
    saveMutation.reset();
  });

  function invalidateConfirmation(): void {
    filterRevisionRef.current += 1;
    prepareAbortControllerRef.current?.abort();
    prepareAbortControllerRef.current = null;
    saveAbortControllerRef.current?.abort();
    saveAbortControllerRef.current = null;
    prepareMutation.reset();
    saveMutation.reset();
    setConfirmation(null);
    setDialogOpen(false);
  }

  function changeMode(nextMode: ExportMode): void {
    if (nextMode === mode) return;
    setMode(nextMode);
    invalidateConfirmation();
  }

  function openExportConfirmation(): void {
    if (confirmation) {
      setDialogOpen(true);
      return;
    }
    if (prepareMutation.isPending || (mode === 'filtered' && selectedEvents.length === 0)) {
      return;
    }

    const input: ExportRequestInput =
      mode === 'full'
        ? { type: 'full' }
        : {
            type: 'filtered',
            startEventIds: selectedEvents.map((event) => event.id),
            direction,
            depth,
          };
    saveMutation.reset();
    const controller = new AbortController();
    prepareAbortControllerRef.current = controller;
    prepareMutation.mutate({
      input,
      signal: controller.signal,
      filterRevision: filterRevisionRef.current,
    });
  }

  function confirmExport(): void {
    if (!confirmation || saveMutation.isPending) return;
    prepareMutation.reset();
    const controller = new AbortController();
    saveAbortControllerRef.current = controller;
    saveMutation.mutate({
      token: confirmation.token,
      signal: controller.signal,
      filterRevision: filterRevisionRef.current,
    });
  }

  const exportDisabled =
    prepareMutation.isPending || (mode === 'filtered' && selectedEvents.length === 0);

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
              invalidateConfirmation();
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
                invalidateConfirmation();
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
                invalidateConfirmation();
              }}
            />
          </div>
        </div>
      ) : null}

      <div className="data-transfer-export-actions">
        <button
          className="button button--primary"
          type="button"
          disabled={exportDisabled}
          onClick={openExportConfirmation}
        >
          {prepareMutation.isPending ? '正在统计…' : confirmation ? '查看导出确认' : '数据导出'}
        </button>
      </div>

      {error ? (
        <div className="form-alert data-transfer-export-message" role="alert">
          {error}
        </div>
      ) : null}
      <ExportConfirmDialog
        open={dialogOpen}
        confirmation={confirmation}
        pending={saveMutation.isPending}
        onClose={() => {
          if (!saveMutation.isPending) setDialogOpen(false);
        }}
        onConfirm={confirmExport}
      />
    </section>
  );
}
