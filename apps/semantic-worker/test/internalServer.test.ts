import type { SemanticModelCode } from '@causality/semantic-core';
import { describe, expect, it } from 'vitest';

import {
  ActiveModelMismatchError,
  SemanticWorkerService,
  buildInternalServer,
  type SemanticWorkerQueryService,
} from '../src/internalServer.js';
import type { DownloadJobRepository } from '../src/jobs/jobRepository.js';
import type { EmbeddingRuntime } from '../src/model/modelRuntime.js';

function queryService(activeModelCode: SemanticModelCode | null): SemanticWorkerQueryService {
  return {
    health: () => ({
      status: 'ok',
      modelLoaded: activeModelCode !== null,
      activeModelCode,
    }),
    embedQuery: async (modelCode) => {
      if (modelCode !== activeModelCode) throw new ActiveModelMismatchError();
      return {
        modelCode,
        dimensions: 384,
        vector: Array.from({ length: 384 }, () => 0.05),
      };
    },
  };
}

function startupRepository() {
  const unavailable: Array<{ modelCode: SemanticModelCode; error: string }> = [];
  const repository: DownloadJobRepository = {
    claimNextDownload: async () => null,
    renewLease: async () => undefined,
    markDownloading: async () => undefined,
    updateDownloadProgress: async () => undefined,
    markVerifying: async () => undefined,
    completeDownload: async () => undefined,
    failDownload: async () => undefined,
    findReadyActiveModel: async () => ({
      modelCode: 'multilingual-e5-small',
      revision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
    }),
    markActiveModelUnavailable: async (modelCode, error) => {
      unavailable.push({ modelCode, error });
    },
  };
  return { repository, unavailable };
}

describe('semantic worker internal server', () => {
  it('returns health and a typed embedding for the active loaded model', async () => {
    const app = buildInternalServer({ service: queryService('multilingual-e5-small') });

    const health = await app.inject({ method: 'GET', url: '/internal/health' });
    const embedding = await app.inject({
      method: 'POST',
      url: '/internal/embed-query',
      payload: {
        modelCode: 'multilingual-e5-small',
        text: '政策利率提高',
      },
    });

    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({
      status: 'ok',
      modelLoaded: true,
      activeModelCode: 'multilingual-e5-small',
    });
    expect(embedding.statusCode).toBe(200);
    const embeddingBody = embedding.json();
    expect(embeddingBody).toMatchObject({
      modelCode: 'multilingual-e5-small',
      dimensions: 384,
    });
    expect(embeddingBody.vector).toHaveLength(384);
    await app.close();
  });

  it('strictly validates model code, text length, and additional fields', async () => {
    const app = buildInternalServer({ service: queryService('multilingual-e5-small') });

    for (const payload of [
      { modelCode: 'unknown', text: '查询' },
      { modelCode: 'multilingual-e5-small', text: ' ' },
      { modelCode: 'multilingual-e5-small', text: 'a'.repeat(201) },
      { modelCode: 'multilingual-e5-small', text: '查询', repository: 'arbitrary/model' },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/embed-query',
        payload,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    }
    await app.close();
  });

  it('rejects a model other than the active loaded model', async () => {
    const app = buildInternalServer({ service: queryService('multilingual-e5-small') });

    const response = await app.inject({
      method: 'POST',
      url: '/internal/embed-query',
      payload: { modelCode: 'bge-m3', text: '市场变化' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'SEMANTIC_MODEL_UNAVAILABLE' });
    await app.close();
  });

  it('marks a ready database model unavailable when its local manifest is missing', async () => {
    const fake = startupRepository();
    let loaded = false;
    const runtime: EmbeddingRuntime = {
      load: async () => {
        loaded = true;
      },
      embedQuery: async () => [],
      embedDocuments: async () => [],
      dispose: async () => undefined,
    };
    const service = new SemanticWorkerService({
      repository: fake.repository,
      runtime,
      modelsDirectory: '/models',
      verifyModel: async () => false,
    });

    await service.initialize();

    expect(loaded).toBe(false);
    expect(service.health()).toEqual({
      status: 'ok',
      modelLoaded: false,
      activeModelCode: null,
    });
    expect(fake.unavailable).toEqual([
      {
        modelCode: 'multilingual-e5-small',
        error: '本地语义模型文件缺失或校验失败',
      },
    ]);
  });
});
