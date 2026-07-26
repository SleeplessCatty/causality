import { describe, expect, it } from 'vitest';

import {
  apiErrorSchema,
  caseListResponseSchema,
  caseListQuerySchema,
  eventListQuerySchema,
  eventListResponseSchema,
  relationListQuerySchema,
  relationListResponseSchema,
  semanticActionAcceptedSchema,
  semanticLifecycleSnapshotSchema,
  semanticModelParamsSchema,
  semanticThresholdInputSchema,
} from '../src/index.js';

const timestamp = '2026-07-23T15:00:00.000Z';
const taskId = '11111111-1111-4111-8111-111111111111';

describe('semantic search contracts', () => {
  it('adds a strict enhanced search mode to all main list queries', () => {
    expect(eventListQuerySchema.parse({ q: ' 利率 ', searchMode: 'enhanced' })).toMatchObject({
      q: '利率',
      searchMode: 'enhanced',
    });
    expect(relationListQuerySchema.parse({}).searchMode).toBe('standard');
    expect(caseListQuerySchema.parse({ searchMode: 'standard' }).searchMode).toBe('standard');
    expect(caseListQuerySchema.safeParse({ searchMode: 'other' }).success).toBe(false);
  });

  it('uses one strict semantic index notice field in all list responses', () => {
    for (const schema of [
      eventListResponseSchema,
      relationListResponseSchema,
      caseListResponseSchema,
    ]) {
      const response = {
        items: [],
        page: 1,
        pageSize: 50,
        totalItems: 0,
        totalPages: 1,
      };
      expect(schema.parse(response)).toMatchObject({ semanticIndexNotice: null });
      expect(
        schema.parse({
          ...response,
          semanticIndexNotice: 'incomplete',
        }),
      ).toMatchObject({ semanticIndexNotice: 'incomplete' });
      expect(schema.safeParse({ ...response, semanticIndexUpdating: true }).success).toBe(false);
    }
  });

  it('accepts an incomplete lifecycle snapshot with model presentation metadata', () => {
    expect(
      semanticLifecycleSnapshotSchema.parse({
        currentModelCode: 'bge-small-zh-v1.5',
        models: [
          {
            modelCode: 'bge-small-zh-v1.5',
            label: '中文轻量',
            description: '适合中文语义查询',
            languageLabel: '中文',
            dimensions: 512,
            expectedDownloadBytes: 25_200_000,
            threshold: 65,
            downloadedAt: timestamp,
            fileState: 'downloaded',
            role: 'current',
            stage: 'incomplete',
            availableForEnhancedSearch: true,
            allowedActions: ['reindex'],
            failure: null,
          },
        ],
        index: {
          status: 'incomplete',
          processedItems: 599,
          totalItems: 600,
          pendingItems: 0,
          failedItems: 1,
          availableForEnhancedSearch: true,
          failure: null,
          updatedAt: timestamp,
        },
        operation: null,
        worker: {
          status: 'online',
          modelState: 'loaded',
          loadedModelCode: 'bge-small-zh-v1.5',
          checkedAt: timestamp,
        },
        pollAfterMs: null,
        updatedAt: timestamp,
      }),
    ).toMatchObject({
      index: { status: 'incomplete' },
      models: [{ modelCode: 'bge-small-zh-v1.5', threshold: 65 }],
    });
  });

  it('accepts running download progress and a mismatched Worker', () => {
    const parsed = semanticLifecycleSnapshotSchema.parse({
      currentModelCode: 'multilingual-e5-small',
      models: [
        {
          modelCode: 'multilingual-e5-small',
          label: '轻量快速',
          description: '适合普通 CPU 的快速中英文语义查询',
          languageLabel: '中文、英文及中英混排',
          dimensions: 384,
          expectedDownloadBytes: 135_392_857,
          threshold: 70,
          downloadedAt: null,
          fileState: 'downloading',
          role: 'current',
          stage: 'downloading',
          availableForEnhancedSearch: false,
          allowedActions: [],
          failure: null,
        },
      ],
      index: {
        status: 'waiting_model',
        processedItems: 0,
        totalItems: 0,
        pendingItems: 0,
        failedItems: 0,
        availableForEnhancedSearch: false,
        failure: null,
        updatedAt: timestamp,
      },
      operation: {
        type: 'download',
        phase: 'downloading',
        status: 'running',
        modelCode: 'multilingual-e5-small',
        attempt: 1,
        maxAttempts: 3,
        progress: {
          unit: 'bytes',
          completed: 12_000_000,
          total: 135_392_857,
        },
        nextRetryAt: null,
        failure: null,
      },
      worker: {
        status: 'online',
        modelState: 'mismatch',
        loadedModelCode: 'bge-m3',
        checkedAt: timestamp,
      },
      pollAfterMs: 1_000,
      updatedAt: timestamp,
    });

    expect(parsed.operation).toMatchObject({
      type: 'download',
      progress: { unit: 'bytes', completed: 12_000_000 },
    });
    expect(parsed.worker).toMatchObject({
      modelState: 'mismatch',
      loadedModelCode: 'bge-m3',
    });
  });

  it('accepts strict per-model threshold updates', () => {
    expect(semanticThresholdInputSchema.parse({ threshold: 65 })).toEqual({ threshold: 65 });
    expect(semanticThresholdInputSchema.safeParse({ threshold: 65.5 }).success).toBe(false);
    expect(semanticThresholdInputSchema.safeParse({ threshold: 101 }).success).toBe(false);
    expect(semanticThresholdInputSchema.safeParse({ threshold: 65, extra: true }).success).toBe(
      false,
    );
  });

  it('accepts only pinned model codes in route parameters', () => {
    expect(semanticModelParamsSchema.parse({ modelCode: 'multilingual-e5-small' })).toEqual({
      modelCode: 'multilingual-e5-small',
    });
    expect(semanticModelParamsSchema.safeParse({ modelCode: 'unknown-model' }).success).toBe(false);
    expect(
      semanticModelParamsSchema.safeParse({
        modelCode: 'bge-m3',
        repository: 'arbitrary/model',
      }).success,
    ).toBe(false);
  });

  it('accepts semantic actions and rejects extra progress fields', () => {
    expect(
      semanticActionAcceptedSchema.parse({
        accepted: true,
        taskId,
        activeModelCode: 'multilingual-e5-small',
      }),
    ).toEqual({
      accepted: true,
      taskId,
      activeModelCode: 'multilingual-e5-small',
    });
    expect(() =>
      semanticActionAcceptedSchema.parse({
        accepted: true,
        taskId,
        activeModelCode: 'multilingual-e5-small',
        matchReason: 'not public',
      }),
    ).toThrow();
  });

  it('accepts stable semantic API error codes', () => {
    for (const code of [
      'SEMANTIC_QUERY_EMPTY',
      'SEMANTIC_MODEL_UNAVAILABLE',
      'SEMANTIC_MODEL_DOWNLOADING',
      'SEMANTIC_INDEX_BUILDING',
      'SEMANTIC_INDEX_FAILED',
      'SEMANTIC_WORKER_UNAVAILABLE',
      'SEMANTIC_SWITCH_CONFLICT',
      'SEMANTIC_ACTION_NOT_ALLOWED',
      'SEMANTIC_HIGH_LEVEL_TASK_ACTIVE',
      'SEMANTIC_MODEL_NOT_CURRENT',
    ] as const) {
      expect(apiErrorSchema.parse({ code, message: '增强查询暂不可用' }).code).toBe(code);
    }
  });
});
