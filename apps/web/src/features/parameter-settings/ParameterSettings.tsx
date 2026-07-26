import type { SemanticModel, SemanticModelCode } from '@causality/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { ApiClientError } from '../../shared/api/httpClient';
import { useAutoDismissError } from '../../shared/forms/useAutoDismissError';
import { SemanticModelCard } from './SemanticModelCard';
import { SemanticModelActionDialog, type SemanticModelAction } from './SemanticModelActionDialog';
import { SemanticTaskProgress } from './SemanticTaskProgress';
import {
  getSemanticSettings,
  reindexSemanticModel,
  retrySemanticTask,
  updateSemanticThreshold,
  useSemanticModel,
} from './parameterSettingsApi';
import { formatSemanticDate, isActiveSemanticTask } from './semanticPresentation';

const settingsQueryKey = ['semantic', 'settings'] as const;

function actionErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.details.message;
  if (error instanceof Error) return error.message;
  return '操作失败，请稍后重试';
}

export function ParameterSettings() {
  const queryClient = useQueryClient();
  const [modelAction, setModelAction] = useState<SemanticModelAction | null>(null);
  const [actionError, setActionError] = useState<string>();
  const [errorRevision, setErrorRevision] = useState(0);

  useAutoDismissError(Boolean(actionError), errorRevision, () => setActionError(undefined));

  const settings = useQuery({
    queryKey: settingsQueryKey,
    queryFn: ({ signal }) => getSemanticSettings(signal),
    refetchInterval: (query) =>
      isActiveSemanticTask(query.state.data?.activeTask ?? null) ? 1_000 : false,
  });

  function reportError(error: unknown): void {
    setActionError(actionErrorMessage(error));
    setErrorRevision((revision) => revision + 1);
  }

  const useModel = useMutation({
    mutationFn: useSemanticModel,
    onSuccess: async () => {
      setModelAction(null);
      await queryClient.invalidateQueries({ queryKey: settingsQueryKey });
    },
    onError: reportError,
  });
  const updateThreshold = useMutation({
    mutationFn: ({ modelCode, threshold }: { modelCode: SemanticModelCode; threshold: number }) =>
      updateSemanticThreshold(modelCode, threshold),
    onSuccess: (nextSettings) => {
      queryClient.setQueryData(settingsQueryKey, nextSettings);
    },
    onError: reportError,
  });
  const retryTask = useMutation({
    mutationFn: retrySemanticTask,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: settingsQueryKey });
    },
    onError: reportError,
  });
  const reindexModel = useMutation({
    mutationFn: reindexSemanticModel,
    onSuccess: async () => {
      setModelAction(null);
      await queryClient.invalidateQueries({ queryKey: settingsQueryKey });
    },
    onError: reportError,
  });

  if (settings.isPending) {
    return <div className="page-state">正在加载参数配置…</div>;
  }
  if (settings.isError || !settings.data) {
    return (
      <div className="page-state page-state--error">
        <span>参数配置加载失败</span>
        <button
          className="button button--secondary"
          type="button"
          onClick={() => void settings.refetch()}
        >
          重新加载
        </button>
      </div>
    );
  }

  const current = settings.data;
  const taskActive = isActiveSemanticTask(current.activeTask);
  const busy = taskActive || useModel.isPending || retryTask.isPending || reindexModel.isPending;

  function requestUse(model: SemanticModel): void {
    setActionError(undefined);
    if (current.activeModelCode === null) {
      useModel.mutate(model.code);
      return;
    }
    setModelAction({ type: 'switch', model });
  }

  return (
    <section className="parameter-settings-page" aria-labelledby="parameter-settings-title">
      <div className="page-heading">
        <div>
          <h1 id="parameter-settings-title">参数配置</h1>
          <p>管理本地语义模型及增强查询参数</p>
        </div>
      </div>

      {actionError && !modelAction ? (
        <div className="form-alert parameter-settings-alert" role="alert">
          {actionError}
        </div>
      ) : null}

      <section className="semantic-settings-section" aria-labelledby="semantic-settings-title">
        <div className="semantic-settings-section__heading">
          <div>
            <h2 id="semantic-settings-title">语义增强查询</h2>
            <p>模型下载完成后会自动加载并生成当前业务数据的语义索引。</p>
          </div>
          {current.index.updatedAt ? (
            <span>最近更新 {formatSemanticDate(current.index.updatedAt)}</span>
          ) : null}
        </div>

        {current.activeTask ? <SemanticTaskProgress task={current.activeTask} /> : null}

        <div className="semantic-model-grid">
          {current.models.map((model) => (
            <SemanticModelCard
              key={model.code}
              model={model}
              indexStatus={current.index.status}
              busy={busy}
              thresholdPending={
                updateThreshold.isPending && updateThreshold.variables?.modelCode === model.code
              }
              reindexPending={reindexModel.isPending && model.isActive}
              onUse={requestUse}
              onReindex={() => setModelAction({ type: 'reindex', model })}
              onThreshold={(modelCode, threshold) =>
                updateThreshold.mutateAsync({ modelCode, threshold }).then(() => undefined)
              }
            />
          ))}
        </div>

        {current.index.status === 'failed' || current.activeTask?.status === 'failed' ? (
          <div className="semantic-retry">
            <div>
              <strong>语义任务未完成</strong>
              <span>{current.index.error ?? current.activeTask?.error ?? '请重试当前任务。'}</span>
            </div>
            <button
              className="button button--secondary"
              type="button"
              disabled={busy}
              onClick={() => retryTask.mutate()}
            >
              {retryTask.isPending ? '重试中…' : '重试任务'}
            </button>
          </div>
        ) : null}
      </section>

      <SemanticModelActionDialog
        action={modelAction}
        pending={modelAction?.type === 'reindex' ? reindexModel.isPending : useModel.isPending}
        error={actionError}
        onCancel={() => {
          setModelAction(null);
          setActionError(undefined);
        }}
        onConfirm={() => {
          if (modelAction?.type === 'reindex') {
            reindexModel.mutate();
          } else if (modelAction) {
            useModel.mutate(modelAction.model.code);
          }
        }}
      />
    </section>
  );
}
