import type {
  SemanticFailure,
  SemanticIndexStatus,
  SemanticModelFileStatus,
  SemanticWorkerStatus,
} from '@causality/contracts';
import { describe, expect, it } from 'vitest';

import { resolveSemanticLifecycle } from '../src/features/semantic/semanticLifecycleResolver.js';
import type {
  SemanticIndexState,
  SemanticJobState,
  SemanticLifecycleResolverInput,
  SemanticModelState,
} from '../src/features/semantic/semanticLifecycleTypes.js';

const timestamp = '2026-07-26T10:00:00.000Z';
const currentModelCode = 'bge-small-zh-v1.5' as const;

const fullIndexFailure: SemanticFailure = {
  stage: 'full_index',
  kind: 'retryable',
  code: 'DATABASE_TEMPORARILY_UNAVAILABLE',
  message: '数据库暂时不可用',
  attempts: 3,
  occurredAt: timestamp,
};

function modelState(overrides: Partial<SemanticModelState> = {}): SemanticModelState {
  return {
    modelCode: currentModelCode,
    label: '中文轻量',
    description: '适合中文语义查询',
    languageLabel: '中文',
    dimensions: 512,
    expectedDownloadBytes: 25_200_000,
    threshold: 65,
    downloadedAt: timestamp,
    fileState: 'downloaded',
    failure: null,
    ...overrides,
  };
}

function indexState(overrides: Partial<SemanticIndexState> = {}): SemanticIndexState {
  return {
    currentModelCode,
    status: 'ready',
    stateVersion: 3,
    processedItems: 600,
    totalItems: 600,
    pendingItems: 0,
    failedItems: 0,
    failure: null,
    updatedAt: timestamp,
    ...overrides,
  };
}

function workerStatus(overrides: Partial<SemanticWorkerStatus> = {}): SemanticWorkerStatus {
  return {
    status: 'online',
    modelState: 'loaded',
    loadedModelCode: currentModelCode,
    checkedAt: timestamp,
    ...overrides,
  };
}

function lifecycleInput(
  overrides: Omit<Partial<SemanticLifecycleResolverInput>, 'index'> & {
    index?: Partial<SemanticIndexState>;
  } = {},
): SemanticLifecycleResolverInput {
  const { index, ...rest } = overrides;
  return {
    models: [modelState()],
    jobs: [],
    worker: workerStatus(),
    now: timestamp,
    ...rest,
    index: indexState(index),
  };
}

function currentJob(overrides: Partial<SemanticJobState> = {}): SemanticJobState {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    type: 'full_index',
    status: 'running',
    phase: 'indexing',
    modelCode: currentModelCode,
    stateVersion: 3,
    attempt: 1,
    processedItems: 120,
    totalItems: 600,
    downloadedBytes: 0,
    totalBytes: 0,
    nextRetryAt: null,
    failure: null,
    createdAt: timestamp,
    ...overrides,
  };
}

describe('resolveSemanticLifecycle', () => {
  it.each([
    ['ready', 0, 0, true, null, ['reindex']],
    ['updating', 2, 0, true, 1_000, []],
    ['incomplete', 0, 1, true, null, ['reindex']],
    ['building', 0, 0, false, 1_000, []],
    ['failed', 0, 0, false, null, ['retry_full_index']],
  ] as const)(
    'resolves %s index availability, polling, and current-model actions',
    (status, pendingItems, failedItems, available, pollAfterMs, actions) => {
      const activeJobs: SemanticJobState[] =
        status === 'updating'
          ? [
              currentJob({
                type: 'incremental',
                status: 'queued',
                phase: 'waiting',
              }),
            ]
          : status === 'building'
            ? [currentJob()]
            : [];
      const failure = status === 'failed' ? fullIndexFailure : null;
      const snapshot = resolveSemanticLifecycle(
        lifecycleInput({
          index: {
            status: status as SemanticIndexStatus,
            pendingItems,
            failedItems,
            failure,
          },
          jobs: activeJobs,
        }),
      );

      expect(snapshot.index.availableForEnhancedSearch).toBe(available);
      expect(snapshot.pollAfterMs).toBe(pollAfterMs);
      expect(snapshot.models.find((model) => model.role === 'current')?.allowedActions).toEqual(
        actions,
      );
    },
  );

  it.each([
    ['not_downloaded', 'download_and_use'],
    ['downloaded', 'use'],
    ['failed', 'download_and_use'],
    ['invalid', 'redownload_and_use'],
  ] as const)('maps inactive %s files to %s', (fileState, action) => {
    const inactiveModel = modelState({
      modelCode: 'multilingual-e5-small',
      fileState: fileState as SemanticModelFileStatus,
      downloadedAt: fileState === 'downloaded' ? timestamp : null,
    });

    const snapshot = resolveSemanticLifecycle(
      lifecycleInput({ models: [modelState(), inactiveModel] }),
    );

    expect(
      snapshot.models.find((model) => model.modelCode === 'multilingual-e5-small'),
    ).toMatchObject({
      role: 'inactive',
      stage: fileState,
      allowedActions: [action],
    });
  });

  it('blocks every model action while a high-level operation is active', () => {
    const snapshot = resolveSemanticLifecycle(
      lifecycleInput({
        models: [
          modelState(),
          modelState({
            modelCode: 'bge-m3',
            fileState: 'not_downloaded',
            downloadedAt: null,
          }),
        ],
        index: { status: 'building' },
        jobs: [currentJob()],
      }),
    );

    expect(snapshot.models.every((model) => model.allowedActions.length === 0)).toBe(true);
  });

  it.each([
    ['unreachable', 'missing', null],
    ['online', 'missing', null],
    ['online', 'mismatch', 'bge-m3'],
  ] as const)(
    'keeps a ready index unavailable when Worker is %s/%s',
    (status, modelStateValue, loadedModelCode) => {
      const snapshot = resolveSemanticLifecycle(
        lifecycleInput({
          worker: workerStatus({
            status,
            modelState: modelStateValue,
            loadedModelCode,
          }),
        }),
      );

      expect(snapshot.index.status).toBe('ready');
      expect(snapshot.index.availableForEnhancedSearch).toBe(false);
      expect(snapshot.worker).toMatchObject({
        status,
        modelState: modelStateValue,
      });
    },
  );

  it('discards stale jobs and exposes only the current high-level operation', () => {
    const snapshot = resolveSemanticLifecycle(
      lifecycleInput({
        index: { status: 'building', stateVersion: 3 },
        jobs: [
          currentJob({
            id: '22222222-2222-4222-8222-222222222222',
            type: 'download',
            phase: 'downloading',
            stateVersion: 2,
          }),
          currentJob(),
        ],
      }),
    );

    expect(snapshot.operation).toMatchObject({
      type: 'full_index',
      phase: 'indexing',
      progress: { unit: 'items', completed: 120, total: 600 },
    });
  });

  it('uses five-second polling when active work remains but Worker is unreachable', () => {
    const snapshot = resolveSemanticLifecycle(
      lifecycleInput({
        index: { status: 'building' },
        jobs: [currentJob()],
        worker: workerStatus({
          status: 'unreachable',
          modelState: 'missing',
          loadedModelCode: null,
        }),
      }),
    );

    expect(snapshot.pollAfterMs).toBe(5_000);
  });

  it('derives recovery from stable failure fields rather than message text', () => {
    const snapshot = resolveSemanticLifecycle(
      lifecycleInput({
        index: {
          status: 'failed',
          failure: {
            ...fullIndexFailure,
            message: '任意用户可读说明都不影响恢复动作',
          },
        },
      }),
    );

    expect(snapshot.models[0]?.allowedActions).toEqual(['retry_full_index']);
  });
});
