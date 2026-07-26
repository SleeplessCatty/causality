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
  };
}

function startupRepository() {
  const invalid: Array<{ modelCode: SemanticModelCode; code: string }> = [];
  const loadFailures: Array<{ modelCode: SemanticModelCode; code: string }> = [];
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
    invalidateActiveModel: async (modelCode, failure) => {
      invalid.push({ modelCode, code: failure.code });
    },
    failActiveModelLoad: async (modelCode, failure) => {
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

  it('removes and invalidates a ready database model when its local manifest is missing', async () => {
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
    await expect(access(modelDirectory)).rejects.toThrow();
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

  it('keeps internal inference unavailable while a newly loaded model is being indexed', async () => {
    const fake = startupRepository();
    const runtime: EmbeddingRuntime = {
      load: async () => undefined,
      embedQuery: async () => Array.from({ length: 384 }, () => 0.1),
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
