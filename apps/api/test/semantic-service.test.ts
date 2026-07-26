import type {
  SemanticModelCode,
  SemanticSettingsResponse,
  SemanticUseModelResponse,
} from '@causality/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  SemanticRepositoryError,
  type SemanticRepository,
} from '../src/features/semantic/semanticTypes.js';
import { SemanticService } from '../src/features/semantic/semanticService.js';

const timestamp = '2026-07-23T16:00:00.000Z';
const taskId = '11111111-1111-4111-8111-111111111111';

function settings(overrides: Partial<SemanticSettingsResponse> = {}): SemanticSettingsResponse {
  return {
    activeModelCode: null,
    index: {
      status: 'empty',
      processedItems: 0,
      totalItems: 0,
      pendingItems: 0,
      updatedAt: timestamp,
      error: null,
    },
    models: [
      {
        code: 'multilingual-e5-small',
        label: '轻量快速',
        description: '适合普通 CPU 的快速中英文语义查询',
        languageLabel: '中文、英文及中英混排',
        dimensions: 384,
        expectedDownloadBytes: 135_392_857,
        threshold: 70,
        downloadStatus: 'not_downloaded',
        downloadedAt: null,
        isActive: false,
        error: null,
      },
      {
        code: 'bge-m3',
        label: '质量优先',
        description: '适合更高质量的中英文语义查询',
        languageLabel: '中文、英文及中英混排',
        dimensions: 1024,
        expectedDownloadBytes: 585_565_019,
        threshold: 55,
        downloadStatus: 'not_downloaded',
        downloadedAt: null,
        isActive: false,
        error: null,
      },
    ],
    activeTask: null,
    ...overrides,
  };
}

function accepted(modelCode: SemanticModelCode): SemanticUseModelResponse {
  return { accepted: true, taskId, activeModelCode: modelCode };
}

function repository(overrides: Partial<SemanticRepository> = {}): SemanticRepository {
  const current = settings();
  return {
    getSettings: vi.fn(async () => current),
    requestUseModel: vi.fn(async (modelCode) => accepted(modelCode)),
    requestReindex: vi.fn(async () => accepted('multilingual-e5-small')),
    retryLatestFailure: vi.fn(async () => accepted('multilingual-e5-small')),
    ...overrides,
  };
}

describe('SemanticService', () => {
  it('returns current settings and a model-use task', async () => {
    const service = new SemanticService(repository());

    await expect(service.settings()).resolves.toMatchObject({ activeModelCode: null });
    await expect(service.useModel('multilingual-e5-small')).resolves.toEqual(
      accepted('multilingual-e5-small'),
    );
    await expect(service.reindex()).resolves.toEqual(accepted('multilingual-e5-small'));
  });

  it('preserves stable repository conflicts and retry responses', async () => {
    const conflict = new SemanticRepositoryError(
      'SEMANTIC_SWITCH_CONFLICT',
      '已有模型下载或索引任务正在执行',
    );
    const service = new SemanticService(
      repository({
        requestUseModel: vi.fn().mockRejectedValue(conflict),
      }),
    );

    await expect(service.useModel('bge-m3')).rejects.toBe(conflict);
    await expect(new SemanticService(repository()).retry()).resolves.toEqual(
      accepted('multilingual-e5-small'),
    );
  });
});
