import type {
  SemanticAction,
  SemanticFailure,
  SemanticIndexStatus,
  SemanticLifecycleSnapshot,
  SemanticModelFileStatus,
  SemanticModelLifecycle,
  SemanticModelStage,
  SemanticOperation,
} from '@causality/contracts';

import type {
  SemanticIndexState,
  SemanticJobState,
  SemanticLifecycleFacts,
  SemanticLifecycleResolverInput,
  SemanticModelState,
} from './semanticLifecycleTypes.js';

const QUERYABLE_INDEX_STATUSES = new Set<SemanticIndexStatus>(['ready', 'updating', 'incomplete']);

const ACTIVE_TASK_STATUSES = new Set(['queued', 'running', 'retry_wait']);
const HIGH_LEVEL_TASK_TYPES = new Set(['download', 'load', 'full_index']);

function isCurrentJob(job: SemanticJobState, index: SemanticIndexState): boolean {
  return job.modelCode === index.currentModelCode && job.stateVersion === index.stateVersion;
}

function isActiveJob(job: SemanticJobState): boolean {
  return ACTIVE_TASK_STATUSES.has(job.status);
}

function isHighLevelJob(
  job: SemanticJobState,
): job is SemanticJobState & { type: 'download' | 'load' | 'full_index' } {
  return HIGH_LEVEL_TASK_TYPES.has(job.type);
}

function operationPriority(
  indexStatus: SemanticIndexStatus,
  type: 'download' | 'load' | 'full_index',
): number {
  if (indexStatus === 'waiting_model' && type === 'download') return 0;
  if (indexStatus === 'loading' && type === 'load') return 0;
  if (
    (indexStatus === 'index_queued' || indexStatus === 'building' || indexStatus === 'failed') &&
    type === 'full_index'
  ) {
    return 0;
  }
  return type === 'download' ? 1 : type === 'load' ? 2 : 3;
}

function selectOperation(
  jobs: readonly SemanticJobState[],
  indexStatus: SemanticIndexStatus,
): (SemanticJobState & { type: 'download' | 'load' | 'full_index' }) | null {
  return (
    jobs.filter(isHighLevelJob).toSorted((left, right) => {
      const priority =
        operationPriority(indexStatus, left.type) - operationPriority(indexStatus, right.type);
      return priority || left.createdAt.localeCompare(right.createdAt);
    })[0] ?? null
  );
}

function toOperation(
  job: SemanticJobState & { type: 'download' | 'load' | 'full_index' },
): SemanticOperation {
  const progress =
    job.type === 'download'
      ? {
          unit: 'bytes' as const,
          completed: job.downloadedBytes,
          total: job.totalBytes,
        }
      : job.type === 'full_index'
        ? {
            unit: 'items' as const,
            completed: job.processedItems,
            total: job.totalItems,
          }
        : null;

  return {
    type: job.type,
    phase: job.phase,
    status: job.status,
    modelCode: job.modelCode,
    attempt: job.attempt,
    maxAttempts: 3,
    progress,
    nextRetryAt: job.nextRetryAt,
    failure: job.failure,
  };
}

function inactiveStage(fileState: SemanticModelFileStatus): SemanticModelStage {
  return fileState;
}

function currentStage(
  model: SemanticModelState,
  index: SemanticIndexState,
  operation: SemanticOperation | null,
): SemanticModelStage {
  if (model.fileState !== 'downloaded') return model.fileState;
  if (operation?.type === 'load') return operation.status === 'failed' ? 'failed' : 'loading';
  if (operation?.type === 'full_index') {
    if (operation.status === 'failed') return 'failed';
    return operation.status === 'queued' || operation.status === 'retry_wait'
      ? 'index_queued'
      : 'building';
  }
  if (operation?.type === 'download') {
    return operation.status === 'failed' ? 'failed' : model.fileState;
  }
  if (index.status === 'empty') return 'downloaded';
  if (index.status === 'waiting_model') return 'loading';
  return index.status;
}

function inactiveActions(fileState: SemanticModelFileStatus): SemanticAction[] {
  if (fileState === 'downloaded') return ['use'];
  if (fileState === 'invalid') return ['redownload_and_use'];
  if (fileState === 'not_downloaded' || fileState === 'failed') {
    return ['download_and_use'];
  }
  return [];
}

function failedIndexActions(failure: SemanticFailure | null): SemanticAction[] {
  if (failure?.stage === 'download') return ['retry_download'];
  if (failure?.stage === 'verify') return ['redownload_and_use'];
  if (failure?.stage === 'load') return ['retry_load'];
  if (failure?.stage === 'full_index' && failure.kind === 'retryable') {
    return ['retry_full_index'];
  }
  return ['reindex'];
}

function currentActions(model: SemanticModelState, index: SemanticIndexState): SemanticAction[] {
  if (model.fileState === 'failed') return ['retry_download'];
  if (model.fileState === 'invalid') return ['redownload_and_use'];
  if (model.fileState === 'not_downloaded') return ['download_and_use'];
  if (index.status === 'failed') return failedIndexActions(index.failure);
  if (index.status === 'ready' || index.status === 'incomplete') return ['reindex'];
  return [];
}

export function resolveSemanticAllowedActions(
  facts: SemanticLifecycleFacts,
  modelCode: SemanticModelState['modelCode'],
): SemanticAction[] {
  const model = facts.models.find((candidate) => candidate.modelCode === modelCode);
  if (!model) return [];
  const hasActiveHighLevelTask = facts.jobs.some((job) => isActiveJob(job) && isHighLevelJob(job));
  if (hasActiveHighLevelTask) return [];
  return modelCode === facts.index.currentModelCode
    ? currentActions(model, facts.index)
    : inactiveActions(model.fileState);
}

function workerCanServeCurrentModel(input: SemanticLifecycleResolverInput): boolean {
  return (
    input.index.currentModelCode !== null &&
    input.worker.status === 'online' &&
    input.worker.modelState === 'loaded' &&
    input.worker.loadedModelCode === input.index.currentModelCode
  );
}

function resolveModelFailure(
  model: SemanticModelState,
  index: SemanticIndexState,
  operation: SemanticOperation | null,
): SemanticFailure | null {
  if (model.failure) return model.failure;
  if (operation?.failure) return operation.failure;
  return index.failure;
}

function resolveModel(options: {
  model: SemanticModelState;
  index: SemanticIndexState;
  operation: SemanticOperation | null;
  highLevelTaskActive: boolean;
  indexAvailable: boolean;
}): SemanticModelLifecycle {
  const { model, index, operation, highLevelTaskActive, indexAvailable } = options;
  const isCurrent = model.modelCode === index.currentModelCode;

  return {
    modelCode: model.modelCode,
    label: model.label,
    description: model.description,
    languageLabel: model.languageLabel,
    dimensions: model.dimensions,
    expectedDownloadBytes: model.expectedDownloadBytes,
    threshold: model.threshold,
    downloadedAt: model.downloadedAt,
    fileState: model.fileState,
    role: isCurrent ? 'current' : 'inactive',
    stage: isCurrent ? currentStage(model, index, operation) : inactiveStage(model.fileState),
    availableForEnhancedSearch: isCurrent && indexAvailable,
    allowedActions: highLevelTaskActive
      ? []
      : isCurrent
        ? currentActions(model, index)
        : inactiveActions(model.fileState),
    failure: isCurrent ? resolveModelFailure(model, index, operation) : model.failure,
  };
}

export function resolveSemanticLifecycle(
  input: SemanticLifecycleResolverInput,
): SemanticLifecycleSnapshot {
  const currentJobs = input.jobs.filter((job) => isCurrentJob(job, input.index));
  const selectedJob = selectOperation(currentJobs, input.index.status);
  const operation = selectedJob ? toOperation(selectedJob) : null;
  const activeJobs = currentJobs.filter(isActiveJob);
  const highLevelTaskActive = activeJobs.some(isHighLevelJob);
  const hasActiveWork = activeJobs.length > 0;
  const indexAvailable =
    QUERYABLE_INDEX_STATUSES.has(input.index.status) && workerCanServeCurrentModel(input);

  return {
    currentModelCode: input.index.currentModelCode,
    models: input.models.map((model) =>
      resolveModel({
        model,
        index: input.index,
        operation,
        highLevelTaskActive,
        indexAvailable,
      }),
    ),
    index: {
      status: input.index.status,
      processedItems: input.index.processedItems,
      totalItems: input.index.totalItems,
      pendingItems: input.index.pendingItems,
      failedItems: input.index.failedItems,
      availableForEnhancedSearch: indexAvailable,
      failure: input.index.failure,
      updatedAt: input.index.updatedAt,
    },
    operation,
    worker: input.worker,
    pollAfterMs: hasActiveWork ? (input.worker.status === 'unreachable' ? 5_000 : 1_000) : null,
    updatedAt: input.now,
  };
}
