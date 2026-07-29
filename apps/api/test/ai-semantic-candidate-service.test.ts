import type { SemanticIndexStatus, SemanticModelFileStatus } from '@causality/contracts';
import type { Pool, QueryResult } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { AiSemanticCandidateService } from '../src/features/ai-capture/aiSemanticCandidateService.js';
import type {
  SemanticQueryContext,
  SemanticQueryContextRepository,
} from '../src/features/semantic/semanticQueryService.js';
import {
  SemanticWorkerClientError,
  type SemanticWorkerClient,
} from '../src/features/semantic/semanticWorkerClient.js';

const candidateIds = Array.from(
  { length: 12 },
  (_, index) => `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
);

function contextRepository(
  status: SemanticIndexStatus,
  options: {
    fileState?: SemanticModelFileStatus | null;
    modelCode?: SemanticQueryContext['modelCode'];
  } = {},
): SemanticQueryContextRepository {
  return {
    activeContext: vi.fn().mockResolvedValue({
      modelCode: options.modelCode === undefined ? 'multilingual-e5-small' : options.modelCode,
      status,
      threshold: 90,
      fileState: options.fileState === undefined ? 'downloaded' : options.fileState,
    }),
  };
}

function workerClient(
  onBatch: (texts: readonly string[]) => void = () => undefined,
): SemanticWorkerClient {
  return {
    health: vi.fn().mockResolvedValue({
      status: 'ok',
      modelLoaded: true,
      activeModelCode: 'multilingual-e5-small',
    }),
    embedQuery: vi.fn().mockResolvedValue(Array.from({ length: 384 }, () => 0.1)),
    embedQueries: vi.fn().mockImplementation(async (_modelCode, texts) => {
      onBatch(texts);
      return texts.map(() => Array.from({ length: 384 }, () => 0.1));
    }),
  };
}

function candidatePool(options: { delayQueries?: boolean } = {}): {
  pool: Pool;
  query: ReturnType<typeof vi.fn>;
  maximumActive(): number;
} {
  let active = 0;
  let maximumActive = 0;
  const query = vi.fn(async (_sql: string, parameters: unknown[]) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    if (options.delayQueries) await new Promise((resolve) => setTimeout(resolve, 1));

    const inputs = JSON.parse(String(parameters[2])) as Array<{ inputIndex: number }>;
    const rows = inputs.flatMap((input) =>
      candidateIds.map((id, rank) => ({
        input_index: input.inputIndex,
        id,
        similarity: 0.99 - rank / 100,
      })),
    );
    active -= 1;
    return { rows } as QueryResult;
  });
  return {
    pool: { query } as unknown as Pool,
    query,
    maximumActive: () => maximumActive,
  };
}

describe('AiSemanticCandidateService', () => {
  it('scores topic relevance with one topic vector and one vector per event', async () => {
    const worker = workerClient();
    const database = candidatePool();
    const firstDimension = [1, ...Array.from({ length: 383 }, () => 0)];
    const secondDimension = [0, 1, ...Array.from({ length: 382 }, () => 0)];
    vi.mocked(worker.embedQueries).mockResolvedValue([
      firstDimension,
      firstDimension,
      secondDimension,
    ]);
    const service = new AiSemanticCandidateService({
      contextRepository: contextRepository('ready'),
      workerClient: worker,
      pool: database.pool,
    });

    await expect(
      service.topicRelevance('利率传导', [
        { ref: 'event-001', name: '政策利率上升' },
        { ref: 'event-002', name: '汽车销量下降' },
      ]),
    ).resolves.toEqual([
      { ref: 'event-001', similarity: 1 },
      { ref: 'event-002', similarity: 0 },
    ]);
    expect(worker.embedQueries).toHaveBeenCalledWith('multilingual-e5-small', [
      '利率传导',
      '政策利率上升',
      '汽车销量下降',
    ]);
    expect(database.query).not.toHaveBeenCalled();
  });

  it('returns no topic signals without reading model state when there are no events', async () => {
    const contexts = contextRepository('ready');
    const worker = workerClient();
    const database = candidatePool();
    const service = new AiSemanticCandidateService({
      contextRepository: contexts,
      workerClient: worker,
      pool: database.pool,
    });

    await expect(service.topicRelevance('主题', [])).resolves.toEqual([]);
    expect(contexts.activeContext).not.toHaveBeenCalled();
    expect(worker.embedQueries).not.toHaveBeenCalled();
    expect(database.query).not.toHaveBeenCalled();
  });

  it('clamps negative cosine similarity into the public zero-to-one signal range', async () => {
    const worker = workerClient();
    const positive = [1, ...Array.from({ length: 383 }, () => 0)];
    const negative = [-1, ...Array.from({ length: 383 }, () => 0)];
    vi.mocked(worker.embedQueries).mockResolvedValue([positive, negative]);
    const service = new AiSemanticCandidateService({
      contextRepository: contextRepository('ready'),
      workerClient: worker,
      pool: candidatePool().pool,
    });

    await expect(
      service.topicRelevance('主题', [{ ref: 'event-001', name: '事件' }]),
    ).resolves.toEqual([{ ref: 'event-001', similarity: 0 }]);
  });

  it.each([
    ['wrong vector count', [[1, ...Array.from({ length: 383 }, () => 0)]]],
    [
      'wrong vector dimensions',
      [
        [1, ...Array.from({ length: 383 }, () => 0)],
        [1, ...Array.from({ length: 382 }, () => 0)],
      ],
    ],
    [
      'non-finite vector value',
      [
        [1, ...Array.from({ length: 383 }, () => 0)],
        [Number.NaN, ...Array.from({ length: 383 }, () => 0)],
      ],
    ],
    [
      'zero-norm event vector',
      [[1, ...Array.from({ length: 383 }, () => 0)], Array.from({ length: 384 }, () => 0)],
    ],
  ] as const)('maps %s to the stable Worker error', async (_name, vectors) => {
    const worker = workerClient();
    vi.mocked(worker.embedQueries).mockResolvedValue(vectors.map((vector) => [...vector]));
    const service = new AiSemanticCandidateService({
      contextRepository: contextRepository('ready'),
      workerClient: worker,
      pool: candidatePool().pool,
    });

    await expect(
      service.topicRelevance('主题', [{ ref: 'event-001', name: '事件' }]),
    ).rejects.toMatchObject({ code: 'SEMANTIC_WORKER_UNAVAILABLE' });
  });

  it('maps topic embedding Worker failures to the stable Worker error', async () => {
    const worker = workerClient();
    vi.mocked(worker.embedQueries).mockRejectedValue(new SemanticWorkerClientError());
    const service = new AiSemanticCandidateService({
      contextRepository: contextRepository('ready'),
      workerClient: worker,
      pool: candidatePool().pool,
    });

    await expect(
      service.topicRelevance('主题', [{ ref: 'event-001', name: '事件' }]),
    ).rejects.toMatchObject({ code: 'SEMANTIC_WORKER_UNAVAILABLE' });
  });

  it('maps a non-finite cosine calculation to the stable Worker error', async () => {
    const worker = workerClient();
    const hugeFirstDimension = [1e308, ...Array.from({ length: 383 }, () => 0)];
    const hugeSecondDimension = [0, 1e308, ...Array.from({ length: 382 }, () => 0)];
    vi.mocked(worker.embedQueries).mockResolvedValue([hugeFirstDimension, hugeSecondDimension]);
    const service = new AiSemanticCandidateService({
      contextRepository: contextRepository('ready'),
      workerClient: worker,
      pool: candidatePool().pool,
    });

    await expect(
      service.topicRelevance('主题', [{ ref: 'event-001', name: '事件' }]),
    ).rejects.toMatchObject({ code: 'SEMANTIC_WORKER_UNAVAILABLE' });
  });

  it.each([
    ['empty', null, null, 'SEMANTIC_MODEL_UNAVAILABLE'],
    ['waiting_model', 'multilingual-e5-small', 'downloading', 'SEMANTIC_MODEL_DOWNLOADING'],
    ['loading', 'multilingual-e5-small', 'downloaded', 'SEMANTIC_INDEX_BUILDING'],
    ['index_queued', 'multilingual-e5-small', 'downloaded', 'SEMANTIC_INDEX_BUILDING'],
    ['building', 'multilingual-e5-small', 'downloaded', 'SEMANTIC_INDEX_BUILDING'],
    ['updating', 'multilingual-e5-small', 'downloaded', 'SEMANTIC_INDEX_BUILDING'],
    ['incomplete', 'multilingual-e5-small', 'downloaded', 'SEMANTIC_INDEX_FAILED'],
    ['failed', 'multilingual-e5-small', 'failed', 'SEMANTIC_INDEX_FAILED'],
  ] as const)(
    'rejects %s instead of generating plan candidates',
    async (status, modelCode, fileState, code) => {
      const pool = candidatePool();
      const contexts = contextRepository(status, { modelCode, fileState });
      const worker = workerClient();
      const service = new AiSemanticCandidateService({
        contextRepository: contexts,
        workerClient: worker,
        pool: pool.pool,
      });

      await expect(service.compare('event', ['需求下降'])).rejects.toMatchObject({ code });
      expect(contexts.activeContext).toHaveBeenCalledTimes(1);
      expect(worker.embedQueries).not.toHaveBeenCalled();
      expect(pool.query).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['not downloaded', 'not_downloaded', 'SEMANTIC_MODEL_UNAVAILABLE'],
    ['download in progress', 'downloading', 'SEMANTIC_MODEL_DOWNLOADING'],
    ['invalid files', 'invalid', 'SEMANTIC_INDEX_FAILED'],
  ] as const)('rejects ready state with %s model files', async (_name, fileState, code) => {
    const service = new AiSemanticCandidateService({
      contextRepository: contextRepository('ready', { fileState }),
      workerClient: workerClient(),
      pool: candidatePool().pool,
    });

    await expect(service.compare('case', ['某企业库存增长'])).rejects.toMatchObject({ code });
  });

  it('maps Worker model mismatch or unavailable responses to one stable error', async () => {
    const worker = workerClient();
    worker.embedQueries = vi.fn().mockRejectedValue(new SemanticWorkerClientError());
    const service = new AiSemanticCandidateService({
      contextRepository: contextRepository('ready'),
      workerClient: worker,
      pool: candidatePool().pool,
    });

    await expect(service.compare('event', ['需求下降'])).rejects.toMatchObject({
      code: 'SEMANTIC_WORKER_UNAVAILABLE',
    });
  });

  it('chunks 129 texts by 64, uses one bulk lookup per chunk, and caps each result at 10', async () => {
    const batchSizes: number[] = [];
    const contexts = contextRepository('ready');
    const database = candidatePool({ delayQueries: true });
    const service = new AiSemanticCandidateService({
      contextRepository: contexts,
      workerClient: workerClient((texts) => batchSizes.push(texts.length)),
      pool: database.pool,
    });
    const texts = Array.from({ length: 129 }, (_, index) => `查询文本 ${index}`);

    const result = await service.compare('event', texts);

    expect(result).toHaveLength(129);
    expect(result.every((matches) => matches.length === 10)).toBe(true);
    expect(result[0]).toEqual(
      candidateIds.slice(0, 10).map((id, index) => ({
        id,
        similarity: 0.99 - index / 100,
      })),
    );
    expect(batchSizes).toEqual([64, 64, 1]);
    expect(contexts.activeContext).toHaveBeenCalledTimes(1);
    expect(database.query).toHaveBeenCalledTimes(3);
    expect(database.maximumActive()).toBe(2);
  });

  it('returns an empty result without reading model state', async () => {
    const contexts = contextRepository('ready');
    const worker = workerClient();
    const database = candidatePool();
    const service = new AiSemanticCandidateService({
      contextRepository: contexts,
      workerClient: worker,
      pool: database.pool,
    });

    await expect(service.compare('case', [])).resolves.toEqual([]);
    expect(contexts.activeContext).not.toHaveBeenCalled();
    expect(worker.embedQueries).not.toHaveBeenCalled();
    expect(database.query).not.toHaveBeenCalled();
  });
});
