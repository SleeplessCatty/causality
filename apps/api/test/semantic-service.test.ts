import type {
  SemanticActionAccepted,
  SemanticModelCode,
  SemanticSettingsResponse,
} from '@causality/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  SemanticRepositoryError,
  type SemanticCommandRepository,
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

function accepted(modelCode: SemanticModelCode): SemanticActionAccepted {
  return { accepted: true, taskId, activeModelCode: modelCode };
}

function repository(overrides: Partial<SemanticRepository> = {}): SemanticRepository {
  const current = settings();
  return {
    getSettings: vi.fn(async () => current),
    ...overrides,
  };
}

function commandRepository(
  overrides: Partial<SemanticCommandRepository> = {},
): SemanticCommandRepository {
  return {
    useModel: vi.fn(async (modelCode) => accepted(modelCode)),
    retryDownload: vi.fn(async (modelCode) => accepted(modelCode)),
    redownload: vi.fn(async (modelCode) => accepted(modelCode)),
    retryLoad: vi.fn(async (modelCode) => accepted(modelCode)),
    retryFullIndex: vi.fn(async (modelCode) => accepted(modelCode)),
    reindex: vi.fn(async () => accepted('multilingual-e5-small')),
    ...overrides,
  };
}

describe('SemanticService', () => {
  it('returns settings and delegates every stage-specific command', async () => {
    const service = new SemanticService(repository(), commandRepository());

    await expect(service.settings()).resolves.toMatchObject({ activeModelCode: null });
    await expect(service.useModel('multilingual-e5-small')).resolves.toEqual(
      accepted('multilingual-e5-small'),
    );
    await expect(service.retryDownload('multilingual-e5-small')).resolves.toEqual(
      accepted('multilingual-e5-small'),
    );
    await expect(service.redownload('multilingual-e5-small')).resolves.toEqual(
      accepted('multilingual-e5-small'),
    );
    await expect(service.retryLoad('multilingual-e5-small')).resolves.toEqual(
      accepted('multilingual-e5-small'),
    );
    await expect(service.retryFullIndex('multilingual-e5-small')).resolves.toEqual(
      accepted('multilingual-e5-small'),
    );
    await expect(service.reindex()).resolves.toEqual(accepted('multilingual-e5-small'));
  });

  it('preserves stable command conflicts', async () => {
    const conflict = new SemanticRepositoryError(
      'SEMANTIC_HIGH_LEVEL_TASK_ACTIVE',
      '已有模型下载或索引任务正在执行',
    );
    const service = new SemanticService(
      repository(),
      commandRepository({
        useModel: vi.fn().mockRejectedValue(conflict),
      }),
    );

    await expect(service.useModel('bge-m3')).rejects.toBe(conflict);
  });
});
