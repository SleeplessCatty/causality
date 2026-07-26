import type { SemanticActionAccepted, SemanticModelCode } from '@causality/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  SemanticRepositoryError,
  type SemanticCommandRepository,
} from '../src/features/semantic/semanticTypes.js';
import { SemanticService } from '../src/features/semantic/semanticService.js';

const taskId = '11111111-1111-4111-8111-111111111111';

function accepted(modelCode: SemanticModelCode): SemanticActionAccepted {
  return { accepted: true, taskId, activeModelCode: modelCode };
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
  it('delegates every stage-specific command', async () => {
    const service = new SemanticService(commandRepository());

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
      commandRepository({
        useModel: vi.fn().mockRejectedValue(conflict),
      }),
    );

    await expect(service.useModel('bge-m3')).rejects.toBe(conflict);
  });
});
