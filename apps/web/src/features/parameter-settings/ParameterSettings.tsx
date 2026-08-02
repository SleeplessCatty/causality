import type {
  SemanticAction,
  SemanticModelCode,
  SemanticModelLifecycle,
} from '@causality/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { ApiClientError } from '../../shared/api/httpClient';
import { useAutoDismissError } from '../../shared/forms/useAutoDismissError';
import { LoadingHeadingStatus, LoadingState } from '../../shared/loading/LoadingState';
import { McpSettingsPanel } from './McpSettingsPanel';
import { SemanticModelCard } from './SemanticModelCard';
import { SemanticModelActionDialog, type SemanticModelAction } from './SemanticModelActionDialog';
import { SemanticTaskProgress } from './SemanticTaskProgress';
import {
  getSemanticLifecycle,
  redownloadSemanticModel,
  reindexSemanticModel,
  retrySemanticDownload,
  retrySemanticFullIndex,
  retrySemanticLoad,
  updateSemanticDedupeThreshold,
  updateSemanticThreshold,
  useSemanticModel,
} from './parameterSettingsApi';
import { formatSemanticDate } from './semanticPresentation';

const lifecycleQueryKey = ['semantic', 'lifecycle'] as const;

function actionErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.details.message;
  if (error instanceof Error) return error.message;
  return '操作失败，请稍后重试';
}

async function runSemanticAction(
  action: SemanticAction,
  modelCode: SemanticModelCode,
): Promise<unknown> {
  switch (action) {
    case 'download_and_use':
    case 'use':
      return useSemanticModel(modelCode);
    case 'retry_download':
      return retrySemanticDownload(modelCode);
    case 'redownload_and_use':
      return redownloadSemanticModel(modelCode);
    case 'retry_load':
      return retrySemanticLoad(modelCode);
    case 'retry_full_index':
      return retrySemanticFullIndex(modelCode);
    case 'reindex':
      return reindexSemanticModel();
    default:
      return assertNever(action);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported semantic action: ${String(value)}`);
}

export function ParameterSettings() {
  const queryClient = useQueryClient();
  const [modelAction, setModelAction] = useState<SemanticModelAction | null>(null);
  const [actionError, setActionError] = useState<string>();
  const [errorRevision, setErrorRevision] = useState(0);

  useAutoDismissError(Boolean(actionError), errorRevision, () => setActionError(undefined));

  const lifecycle = useQuery({
    queryKey: lifecycleQueryKey,
    queryFn: ({ signal }) => getSemanticLifecycle(signal),
    refetchInterval: (query) => query.state.data?.pollAfterMs ?? false,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  function reportError(error: unknown): void {
    setActionError(actionErrorMessage(error));
    setErrorRevision((revision) => revision + 1);
  }

  const executeAction = useMutation({
    mutationFn: ({ action, modelCode }: { action: SemanticAction; modelCode: SemanticModelCode }) =>
      runSemanticAction(action, modelCode),
    onSuccess: async () => {
      setModelAction(null);
      await queryClient.invalidateQueries({ queryKey: lifecycleQueryKey });
    },
    onError: reportError,
  });
  const updateThreshold = useMutation({
    mutationFn: ({ modelCode, threshold }: { modelCode: SemanticModelCode; threshold: number }) =>
      updateSemanticThreshold(modelCode, threshold),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: lifecycleQueryKey });
    },
    onError: reportError,
  });
  const updateDedupeThreshold = useMutation({
    mutationFn: ({ modelCode, threshold }: { modelCode: SemanticModelCode; threshold: number }) =>
      updateSemanticDedupeThreshold(modelCode, threshold),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: lifecycleQueryKey });
    },
    onError: reportError,
  });

  const current = lifecycle.data;

  function requestAction(action: SemanticAction, model: SemanticModelLifecycle): void {
    setActionError(undefined);
    setModelAction({ type: action, model });
  }

  return (
    <section className="parameter-settings-page" aria-labelledby="parameter-settings-title">
      <div className="page-heading">
        <div>
          <h1 id="parameter-settings-title">参数配置</h1>
          <p>管理本地语义模型、增强查询参数及 MCP 服务连接</p>
        </div>
      </div>

      {actionError && !modelAction ? (
        <div className="form-alert parameter-settings-alert" role="alert">
          {actionError}
        </div>
      ) : null}

      <McpSettingsPanel />

      <LoadingState
        pending={lifecycle.isPending}
        fetching={lifecycle.isFetching}
        hasData={Boolean(current)}
        error={lifecycle.error}
        skeleton="settings"
        onRetry={() => void lifecycle.refetch()}
      >
        {current ? (
          <section className="semantic-settings-section" aria-labelledby="semantic-settings-title">
            <div className="semantic-settings-section__heading">
              <div>
                <h2 id="semantic-settings-title">语义增强查询</h2>
                <p>模型下载完成后会自动加载并生成当前业务数据的语义索引。</p>
              </div>
              <span>最近检查 {formatSemanticDate(current.updatedAt)}</span>
              <LoadingHeadingStatus
                fetching={lifecycle.isFetching && !lifecycle.isPending}
                error={lifecycle.error}
                onRetry={() => void lifecycle.refetch()}
              />
            </div>

            {current.operation ? <SemanticTaskProgress operation={current.operation} /> : null}

            {current.index.status === 'incomplete' ? (
              <div className="semantic-retry" role="status">
                <div>
                  <strong>语义索引不完整</strong>
                  <span>失败 {current.index.failedItems} 项</span>
                </div>
              </div>
            ) : null}

            <div className="semantic-model-grid">
              {current.models.map((model) => (
                <SemanticModelCard
                  key={model.modelCode}
                  model={model}
                  actionsDisabled={executeAction.isPending}
                  pendingAction={
                    executeAction.isPending &&
                    executeAction.variables?.modelCode === model.modelCode
                      ? executeAction.variables.action
                      : null
                  }
                  thresholdPending={
                    updateThreshold.isPending &&
                    updateThreshold.variables?.modelCode === model.modelCode
                  }
                  dedupeThresholdPending={
                    updateDedupeThreshold.isPending &&
                    updateDedupeThreshold.variables?.modelCode === model.modelCode
                  }
                  onAction={requestAction}
                  onThreshold={(modelCode, threshold) =>
                    updateThreshold.mutateAsync({ modelCode, threshold }).then(() => undefined)
                  }
                  onDedupeThreshold={(modelCode, threshold) =>
                    updateDedupeThreshold
                      .mutateAsync({ modelCode, threshold })
                      .then(() => undefined)
                  }
                />
              ))}
            </div>
          </section>
        ) : null}
      </LoadingState>

      <SemanticModelActionDialog
        action={modelAction}
        pending={executeAction.isPending}
        error={actionError}
        onCancel={() => {
          setModelAction(null);
          setActionError(undefined);
        }}
        onConfirm={() => {
          if (!modelAction) return;
          executeAction.mutate({
            action: modelAction.type,
            modelCode: modelAction.model.modelCode,
          });
        }}
      />
    </section>
  );
}
