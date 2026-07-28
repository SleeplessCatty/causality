import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SemanticModelCode } from '@causality/semantic-core';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ActiveModelMismatchError,
  SemanticWorkerService,
  buildInternalServer,
  type SemanticWorkerQueryService,
} from '../src/internalServer.js';
import type { DownloadJobRepository } from '../src/jobs/jobTypes.js';
import { ModelFileMissingError } from '../src/model/modelDownloader.js';
import type { EmbeddingRuntime } from '../src/model/modelRuntime.js';

const temporaryDirectories: string[] = [];

async function temporaryModelsDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'causality-internal-server-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

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
    embedQueries: async (modelCode, texts) => {
      if (modelCode !== activeModelCode) throw new ActiveModelMismatchError();
      return {
        modelCode,
        dimensions: 384,
        vectors: texts.map(() => Array.from({ length: 384 }, () => 0.05)),
      };
    },
  };
}

function startupRepository() {
  const invalid: Array<{ modelCode: SemanticModelCode; code: string }> = [];
  const loadFailures: Array<{ modelCode: SemanticModelCode; code: string }> = [];
  const repository: DownloadJobRepository = {
    claimNextDownload: async () => null,
    renewLease: async () => undefined,
    releaseLease: async () => undefined,
    markDownloading: async () => undefined,
    updateDownloadProgress: async () => undefined,
    markVerifying: async () => undefined,
    completeDownload: async () => undefined,
    failDownload: async () => undefined,
    findReadyActiveModel: async () => ({
      modelCode: 'multilingual-e5-small',
      revision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
      stateVersion: 4,
      downloadedAt: '2026-07-26 00:00:00+00',
    }),
    isReadyActiveModel: async () => true,
    invalidateActiveModel: async (modelCode, _stateVersion, _downloadedAt, failure) => {
      invalid.push({ modelCode, code: failure.code });
      return true;
    },
    failActiveModelLoad: async (modelCode, _stateVersion, failure) => {
      loadFailures.push({ modelCode, code: failure.code });
    },
  };
  return { repository, invalid, loadFailures };
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

  it('returns one vector per batch query and rejects invalid or oversized batches', async () => {
    const app = buildInternalServer({ service: queryService('multilingual-e5-small') });
    const valid = await app.inject({
      method: 'POST',
      url: '/internal/embed-queries',
      payload: {
        modelCode: 'multilingual-e5-small',
        texts: ['需求下降', '库存上升'],
      },
    });

    expect(valid.statusCode).toBe(200);
    expect(valid.json()).toMatchObject({
      modelCode: 'multilingual-e5-small',
      dimensions: 384,
    });
    expect(valid.json().vectors).toHaveLength(2);

    for (const payload of [
      { modelCode: 'multilingual-e5-small', texts: [] },
      { modelCode: 'multilingual-e5-small', texts: [' '] },
      { modelCode: 'multilingual-e5-small', texts: ['a'.repeat(201)] },
      {
        modelCode: 'multilingual-e5-small',
        texts: Array.from({ length: 65 }, (_, index) => `查询${index}`),
      },
      { modelCode: 'multilingual-e5-small', texts: ['查询'], extra: true },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/embed-queries',
        payload,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    }
    await app.close();
  });

  it('accepts the maximum valid batch of 64 Chinese texts with 200 characters each', async () => {
    const app = buildInternalServer({ service: queryService('multilingual-e5-small') });
    const response = await app.inject({
      method: 'POST',
      url: '/internal/embed-queries',
      payload: {
        modelCode: 'multilingual-e5-small',
        texts: Array.from({ length: 64 }, () => '因'.repeat(200)),
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().vectors).toHaveLength(64);
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

  it('invalidates but does not race-delete a ready model when its manifest is missing', async () => {
    const fake = startupRepository();
    const modelsDirectory = await temporaryModelsDirectory();
    const modelDirectory = join(
      modelsDirectory,
      'multilingual-e5-small',
      '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
    );
    await mkdir(modelDirectory, { recursive: true });
    await writeFile(join(modelDirectory, 'stale-file'), 'stale');
    let loaded = false;
    let disposed = false;
    const runtime: EmbeddingRuntime = {
      load: async () => {
        loaded = true;
      },
      embedQuery: async () => [],
      embedQueries: async () => [],
      embedDocuments: async () => [],
      dispose: async () => {
        disposed = true;
      },
    };
    const service = new SemanticWorkerService({
      repository: fake.repository,
      runtime,
      modelsDirectory,
      validateModel: async () => {
        throw new ModelFileMissingError('config.json');
      },
    });

    await service.initialize();

    expect(loaded).toBe(false);
    expect(service.health()).toEqual({
      status: 'ok',
      modelLoaded: false,
      activeModelCode: null,
    });
    expect(disposed).toBe(true);
    await expect(access(modelDirectory)).resolves.toBeUndefined();
    expect(fake.invalid).toEqual([
      { modelCode: 'multilingual-e5-small', code: 'MODEL_FILE_MISSING' },
    ]);
    expect(fake.loadFailures).toEqual([]);
  });

  it('keeps valid files and records a runtime failure during startup loading', async () => {
    const fake = startupRepository();
    const modelsDirectory = await temporaryModelsDirectory();
    const modelDirectory = join(
      modelsDirectory,
      'multilingual-e5-small',
      '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
    );
    await mkdir(modelDirectory, { recursive: true });
    await writeFile(join(modelDirectory, 'READY.json'), '{}');
    let disposed = false;
    const runtime: EmbeddingRuntime = {
      load: async () => {
        throw new Error('Error loading shared library ld-linux-aarch64.so.1');
      },
      embedQuery: async () => [],
      embedQueries: async () => [],
      embedDocuments: async () => [],
      dispose: async () => {
        disposed = true;
      },
    };
    const service = new SemanticWorkerService({
      repository: fake.repository,
      runtime,
      modelsDirectory,
      validateModel: async () => undefined,
    });

    await service.initialize();

    await expect(access(modelDirectory)).resolves.toBeUndefined();
    expect(disposed).toBe(true);
    expect(fake.invalid).toEqual([]);
    expect(fake.loadFailures).toEqual([
      { modelCode: 'multilingual-e5-small', code: 'MODEL_RUNTIME_INCOMPATIBLE' },
    ]);
  });

  it('persists startup validation failure before best-effort cleanup', async () => {
    const fake = startupRepository();
    const ordering: string[] = [];
    fake.repository.invalidateActiveModel = async () => {
      ordering.push('failed');
      return true;
    };
    const service = new SemanticWorkerService({
      repository: fake.repository,
      runtime: {
        load: async () => undefined,
        embedQuery: async () => [],
        embedQueries: async () => [],
        embedDocuments: async () => [],
        dispose: async () => {
          ordering.push('dispose');
          throw new Error('dispose failed');
        },
      },
      modelsDirectory: await temporaryModelsDirectory(),
      validateModel: async () => {
        throw new ModelFileMissingError('config.json');
      },
    });

    await expect(service.initialize()).resolves.toBeUndefined();
    expect(ordering).toEqual(['failed', 'dispose']);
  });

  it('does not delete model files when a stale startup validation failure is rejected', async () => {
    const fake = startupRepository();
    fake.repository.invalidateActiveModel = async () => false;
    const modelsDirectory = await temporaryModelsDirectory();
    const modelDirectory = join(
      modelsDirectory,
      'multilingual-e5-small',
      '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
    );
    await mkdir(modelDirectory, { recursive: true });
    const service = new SemanticWorkerService({
      repository: fake.repository,
      runtime: {
        load: async () => undefined,
        embedQuery: async () => [],
        embedQueries: async () => [],
        embedDocuments: async () => [],
        dispose: async () => undefined,
      },
      modelsDirectory,
      validateModel: async () => {
        throw new ModelFileMissingError('config.json');
      },
    });

    await service.initialize();

    await expect(access(modelDirectory)).resolves.toBeUndefined();
  });

  it('persists startup load failure before best-effort runtime disposal', async () => {
    const fake = startupRepository();
    const ordering: string[] = [];
    fake.repository.failActiveModelLoad = async () => {
      ordering.push('failed');
    };
    const service = new SemanticWorkerService({
      repository: fake.repository,
      runtime: {
        load: async () => {
          throw new Error('runtime incompatible');
        },
        embedQuery: async () => [],
        embedQueries: async () => [],
        embedDocuments: async () => [],
        dispose: async () => {
          ordering.push('dispose');
          throw new Error('dispose failed');
        },
      },
      modelsDirectory: await temporaryModelsDirectory(),
      validateModel: async () => undefined,
    });

    await expect(service.initialize()).resolves.toBeUndefined();
    expect(ordering).toEqual(['failed', 'dispose']);
  });

  it('disposes a model that stopped being current while startup loading was in progress', async () => {
    const fake = startupRepository();
    fake.repository.isReadyActiveModel = async () => false;
    let disposed = false;
    const service = new SemanticWorkerService({
      repository: fake.repository,
      runtime: {
        load: async () => undefined,
        embedQuery: async () => [],
        embedQueries: async () => [],
        embedDocuments: async () => [],
        dispose: async () => {
          disposed = true;
        },
      },
      modelsDirectory: await temporaryModelsDirectory(),
      validateModel: async () => undefined,
    });

    await service.initialize();

    expect(disposed).toBe(true);
    expect(service.health()).toMatchObject({
      modelLoaded: false,
      activeModelCode: null,
    });
  });

  it('keeps internal inference unavailable while a newly loaded model is being indexed', async () => {
    const fake = startupRepository();
    const runtime: EmbeddingRuntime = {
      load: async () => undefined,
      embedQuery: async () => Array.from({ length: 384 }, () => 0.1),
      embedQueries: async (texts) => texts.map(() => Array.from({ length: 384 }, () => 0.1)),
      embedDocuments: async () => [],
      dispose: async () => undefined,
    };
    const service = new SemanticWorkerService({
      repository: fake.repository,
      runtime,
      modelsDirectory: '/models',
      validateModel: async () => undefined,
    });

    service.markModelLoading();
    expect(service.health().activeModelCode).toBeNull();
    await expect(service.embedQuery('multilingual-e5-small', '索引过程中')).rejects.toBeInstanceOf(
      ActiveModelMismatchError,
    );

    service.markLoadedModel('multilingual-e5-small');
    await expect(service.embedQuery('multilingual-e5-small', '索引完成后')).resolves.toMatchObject({
      modelCode: 'multilingual-e5-small',
      dimensions: 384,
    });
  });
});
