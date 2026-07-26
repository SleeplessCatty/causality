import type {
  SemanticIndexStatus,
  SemanticModel,
  SemanticModelCode,
  SemanticSettingsResponse,
  SemanticTask,
} from '@causality/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { ApiClientError } from '../../shared/api/httpClient';
import { PercentageControl } from '../../shared/controls/PercentageControl';
import { useAutoDismissError } from '../../shared/forms/useAutoDismissError';
import { SemanticModelActionDialog, type SemanticModelAction } from './SemanticModelActionDialog';
import {
  getSemanticSettings,
  reindexSemanticModel,
  retrySemanticTask,
  updateSemanticThreshold,
  useSemanticModel,
} from './parameterSettingsApi';

const settingsQueryKey = ['semantic', 'settings'] as const;

function formatMegabytes(bytes: number): string {
  return `约 ${Math.round(bytes / 1024 / 1024)} MB`;
}

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatDate(value: string | null): string {
  return value ? dateFormatter.format(new Date(value)) : '—';
}

function actionErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.details.message;
  if (error instanceof Error) return error.message;
  return '操作失败，请稍后重试';
}

function isActiveTask(task: SemanticTask | null): boolean {
  return task?.status === 'queued' || task?.status === 'running';
}

type SemanticBadge = {
  label: string;
  tone: 'neutral' | 'positive' | 'negative' | 'working';
};

function downloadStatus(model: SemanticModel): SemanticBadge {
  if (model.downloadStatus === 'downloading') return { label: '下载中', tone: 'working' };
  if (model.downloadStatus === 'verifying') return { label: '正在校验', tone: 'working' };
  if (model.downloadStatus === 'failed') return { label: '下载失败', tone: 'negative' };
  return model.downloadStatus === 'downloaded'
    ? { label: '已下载', tone: 'positive' }
    : { label: '未下载', tone: 'neutral' };
}

function availabilityStatus(model: SemanticModel, indexStatus: SemanticIndexStatus): SemanticBadge {
  return model.isActive && (indexStatus === 'ready' || indexStatus === 'updating')
    ? { label: '可用', tone: 'positive' }
    : { label: '暂不可用', tone: 'neutral' };
}

function modelIndexStatus(model: SemanticModel, indexStatus: SemanticIndexStatus): SemanticBadge {
  if (!model.isActive) return { label: '无当前索引', tone: 'neutral' };
  if (indexStatus === 'waiting_model') return { label: '等待索引', tone: 'working' };
  if (indexStatus === 'loading') return { label: '索引加载中', tone: 'working' };
  if (indexStatus === 'building') return { label: '索引生成中', tone: 'working' };
  if (indexStatus === 'updating') return { label: '索引更新中', tone: 'working' };
  if (indexStatus === 'ready') return { label: '索引就绪', tone: 'positive' };
  if (indexStatus === 'failed') return { label: '索引失败', tone: 'negative' };
  return { label: '索引为空', tone: 'neutral' };
}

interface ModelCardProps {
  model: SemanticModel;
  settings: SemanticSettingsResponse;
  busy: boolean;
  thresholdPending: boolean;
  reindexPending: boolean;
  onUse(model: SemanticModel): void;
  onReindex(): void;
  onThreshold(modelCode: SemanticModelCode, threshold: number): Promise<void>;
}

function ModelCard({
  model,
  settings,
  busy,
  thresholdPending,
  reindexPending,
  onUse,
  onReindex,
  onThreshold,
}: ModelCardProps) {
  const [threshold, setThreshold] = useState<number | null>(model.threshold);
  const statuses = [
    downloadStatus(model),
    availabilityStatus(model, settings.index.status),
    modelIndexStatus(model, settings.index.status),
  ];

  useEffect(() => setThreshold(model.threshold), [model.threshold]);

  async function saveThreshold(): Promise<void> {
    if (threshold === null || !Number.isInteger(threshold) || threshold < 0 || threshold > 100) {
      setThreshold(model.threshold);
      return;
    }
    if (threshold === model.threshold) return;
    try {
      await onThreshold(model.code, threshold);
    } catch {
      setThreshold(model.threshold);
    }
  }

  const actionLabel = model.downloadStatus === 'downloaded' ? '切换到此模型' : '下载并使用';

  return (
    <article
      className={`semantic-model-card${model.isActive ? ' semantic-model-card--active' : ''}`}
      aria-label={model.label}
    >
      <div className="semantic-model-card__heading">
        <div>
          <h2>{model.label}</h2>
          <p>{model.description}</p>
        </div>
      </div>
      <div className="semantic-model-card__badges" aria-label="模型状态">
        {statuses.map((status) => (
          <span key={status.label} className={`semantic-badge semantic-badge--${status.tone}`}>
            {status.label}
          </span>
        ))}
      </div>

      <dl className="semantic-model-card__metadata">
        <div>
          <dt>语言支持</dt>
          <dd>{model.languageLabel}</dd>
        </div>
        <div>
          <dt>预计下载</dt>
          <dd>{formatMegabytes(model.expectedDownloadBytes)}</dd>
        </div>
        <div>
          <dt>最近下载</dt>
          <dd>{formatDate(model.downloadedAt)}</dd>
        </div>
      </dl>

      <PercentageControl
        id={`semantic-threshold-${model.code}`}
        label="相似度门槛"
        value={threshold}
        sliderLabel="相似度门槛滑块"
        numberLabel="相似度门槛数值"
        help="只影响增强查询的候选过滤，不会重新生成索引。"
        disabled={thresholdPending}
        preserveAppearanceWhenDisabled
        onChange={setThreshold}
        onCommit={() => void saveThreshold()}
      />

      {model.error ? (
        <div className="semantic-model-card__error" role="status">
          {model.error}
        </div>
      ) : null}

      <div className="semantic-model-card__actions">
        {model.isActive ? (
          <button
            className="button button--secondary"
            type="button"
            disabled={busy || model.downloadStatus !== 'downloaded'}
            onClick={onReindex}
          >
            {reindexPending ? '重新索引中…' : '重新索引'}
          </button>
        ) : (
          <button
            className="button button--secondary"
            type="button"
            disabled={busy}
            onClick={() => onUse(model)}
          >
            {actionLabel}
          </button>
        )}
      </div>
    </article>
  );
}

function TaskProgress({ task }: { task: SemanticTask }) {
  const isDownload = task.type === 'download';
  const value = isDownload ? task.downloadedBytes : task.processedItems;
  const total = isDownload ? task.totalBytes : task.totalItems;
  const label =
    task.type === 'download'
      ? task.status === 'failed'
        ? '下载失败'
        : '模型下载进度'
      : task.status === 'failed'
        ? '索引任务失败'
        : '索引生成进度';

  return (
    <section className="semantic-task-panel" aria-labelledby="semantic-task-title">
      <div>
        <span id="semantic-task-title">{label}</span>
        <strong>
          {value} / {total}
        </strong>
      </div>
      <progress
        aria-label={task.type === 'download' ? '模型下载进度' : '索引生成进度'}
        value={Math.min(value, Math.max(total, 1))}
        max={Math.max(total, 1)}
      />
      {task.error ? <p>{task.error}</p> : null}
    </section>
  );
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
      isActiveTask(query.state.data?.activeTask ?? null) ? 1_000 : false,
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
  const taskActive = isActiveTask(current.activeTask);
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
            <span>最近更新 {formatDate(current.index.updatedAt)}</span>
          ) : null}
        </div>

        {current.activeTask ? <TaskProgress task={current.activeTask} /> : null}

        <div className="semantic-model-grid">
          {current.models.map((model) => (
            <ModelCard
              key={model.code}
              model={model}
              settings={current}
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
