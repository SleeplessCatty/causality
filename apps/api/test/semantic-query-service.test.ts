import type { SemanticIndexStatus } from '@causality/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  SemanticQueryService,
  type SemanticQueryContextRepository,
} from '../src/features/semantic/semanticQueryService.js';
import type { SemanticSearchRepository } from '../src/features/semantic/semanticSearchRepository.js';
import type { SemanticWorkerClient } from '../src/features/semantic/semanticWorkerClient.js';

function contextRepository(status: SemanticIndexStatus): SemanticQueryContextRepository {
  return {
    activeContext: vi.fn().mockResolvedValue({
      modelCode: status === 'empty' ? null : 'multilingual-e5-small',
      status,
      threshold: status === 'empty' ? null : 70,
      downloadStatus: status === 'empty' ? null : 'downloaded',
    }),
  };
}

function workerClient(): SemanticWorkerClient {
  return {
    health: vi.fn().mockResolvedValue({
      status: 'ok',
      modelLoaded: true,
      activeModelCode: 'multilingual-e5-small',
    }),
    embedQuery: vi.fn().mockResolvedValue(Array.from({ length: 384 }, () => 0.1)),
  };
}

function searchRepository(): SemanticSearchRepository {
  return {
    candidates: vi.fn().mockResolvedValue([
      { id: '10000000-0000-4000-8000-000000000001', similarity: 0.9 },
      { id: '10000000-0000-4000-8000-000000000002', similarity: 0.8 },
    ]),
  };
}

describe('SemanticQueryService', () => {
  it.each([
    ['empty', 'SEMANTIC_MODEL_UNAVAILABLE', '尚未下载并使用语义模型'],
    ['waiting_model', 'SEMANTIC_MODEL_DOWNLOADING', '模型正在下载，增强查询暂不可用'],
    ['loading', 'SEMANTIC_INDEX_BUILDING', '语义索引正在生成，增强查询暂不可用'],
    ['building', 'SEMANTIC_INDEX_BUILDING', '语义索引正在生成，增强查询暂不可用'],
    ['failed', 'SEMANTIC_INDEX_FAILED', '语义索引生成失败'],
  ] as const)('maps %s index state to %s', async (status, code, message) => {
    const service = new SemanticQueryService({
      contextRepository: contextRepository(status),
      workerClient: workerClient(),
      searchRepository: searchRepository(),
    });

    await expect(service.candidateIds('event', '政策变化')).rejects.toMatchObject({
      code,
      message,
    });
  });

  it('rejects an empty enhanced query before loading state or contacting the Worker', async () => {
    const contexts = contextRepository('ready');
    const worker = workerClient();
    const service = new SemanticQueryService({
      contextRepository: contexts,
      workerClient: worker,
      searchRepository: searchRepository(),
    });

    await expect(service.candidateIds('event', '  ')).rejects.toMatchObject({
      code: 'SEMANTIC_QUERY_EMPTY',
      message: '请先输入搜索内容',
    });
    expect(contexts.activeContext).not.toHaveBeenCalled();
    expect(worker.embedQuery).not.toHaveBeenCalled();
  });

  it.each([
    ['ready', false],
    ['updating', true],
  ] as const)(
    'returns ordered candidate IDs and updating=%s metadata for %s state',
    async (status, semanticIndexUpdating) => {
      const worker = workerClient();
      const search = searchRepository();
      const service = new SemanticQueryService({
        contextRepository: contextRepository(status),
        workerClient: worker,
        searchRepository: search,
      });

      await expect(service.candidateIds('relation', '政策变化')).resolves.toEqual({
        ids: ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'],
        semanticIndexUpdating,
      });
      expect(worker.embedQuery).toHaveBeenCalledWith('multilingual-e5-small', '政策变化');
      expect(search.candidates).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'relation',
          modelCode: 'multilingual-e5-small',
          dimensions: 384,
          threshold: 70,
          limit: 100,
        }),
      );
    },
  );
});
