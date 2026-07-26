import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import type { SemanticModelDefinition } from '@causality/semantic-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ModelDownloadTimeoutError,
  ModelDownloadNetworkError,
  ModelFileMissingError,
  ModelHashMismatchError,
  ModelSizeMismatchError,
  PinnedModelDownloader,
  validateReadyModel,
  verifyReadyModel,
} from '../src/model/modelDownloader.js';

const temporaryDirectories: string[] = [];

function digest(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function testModel(
  files: ReadonlyArray<{ path: string; body: Uint8Array }>,
): SemanticModelDefinition {
  const manifest = files.map(({ path, body }) => ({
    remotePath: path,
    localPath: path,
    bytes: body.byteLength,
    sha256: digest(body),
  }));
  return {
    code: 'multilingual-e5-small',
    label: '轻量快速',
    description: '测试模型',
    languageLabel: '中文、英文及中英混排',
    repository: 'owner/model',
    revision: 'fixed-revision',
    dimensions: 384,
    dtype: 'q8',
    pooling: 'mean',
    queryPrefix: 'query: ',
    documentPrefix: 'passage: ',
    maxTokens: 512,
    defaultThreshold: 70,
    files: manifest,
    expectedDownloadBytes: manifest.reduce((sum, file) => sum + file.bytes, 0),
  };
}

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'causality-model-downloader-'));
  temporaryDirectories.push(directory);
  return directory;
}

function fakeFetch(
  model: SemanticModelDefinition,
  bodies: ReadonlyMap<string, Uint8Array>,
): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    const prefix = `https://huggingface.co/${model.repository}/resolve/${model.revision}/`;
    const path = decodeURIComponent(url.slice(prefix.length));
    const body = bodies.get(path);
    return body ? new Response(body) : new Response('missing', { status: 404 });
  }) as typeof fetch;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe('PinnedModelDownloader', () => {
  it('downloads the pinned manifest, reports aggregate progress, and publishes READY.json', async () => {
    const config = new TextEncoder().encode('{"model":"tiny"}');
    const weights = new Uint8Array([1, 2, 3, 4, 5]);
    const model = testModel([
      { path: 'config.json', body: config },
      { path: 'onnx/model_quantized.onnx', body: weights },
    ]);
    const modelsDirectory = await createTemporaryDirectory();
    const target = join(modelsDirectory, model.code, model.revision);
    const progress: Array<{ loaded: number; total: number }> = [];
    const downloader = new PinnedModelDownloader({
      fetch: fakeFetch(
        model,
        new Map([
          ['config.json', config],
          ['onnx/model_quantized.onnx', weights],
        ]),
      ),
    });

    await downloader.download(model, target, async (loaded, total) => {
      progress.push({ loaded, total });
    });

    expect(await readFile(join(target, 'onnx/model_quantized.onnx'))).toEqual(Buffer.from(weights));
    expect(await verifyReadyModel(model, target)).toBe(true);
    expect(progress.at(-1)).toEqual({
      loaded: model.expectedDownloadBytes,
      total: model.expectedDownloadBytes,
    });
  });

  it('removes a corrupt partial download without touching another ready model', async () => {
    const expected = new Uint8Array([10, 11, 12]);
    const corrupt = new Uint8Array([10, 11, 99]);
    const model = testModel([{ path: 'config.json', body: expected }]);
    const modelsDirectory = await createTemporaryDirectory();
    const target = join(modelsDirectory, model.code, model.revision);
    const existingReadyMarker = join(modelsDirectory, 'bge-m3', 'existing', 'READY.json');
    await mkdir(dirname(existingReadyMarker), { recursive: true });
    await writeFile(existingReadyMarker, '{"ready":true}');
    const downloader = new PinnedModelDownloader({
      fetch: fakeFetch(model, new Map([['config.json', corrupt]])),
    });

    await expect(downloader.download(model, target, async () => undefined)).rejects.toBeInstanceOf(
      ModelHashMismatchError,
    );

    await expect(access(join(modelsDirectory, '.partial', model.code))).rejects.toThrow();
    await expect(readFile(existingReadyMarker, 'utf8')).resolves.toBe('{"ready":true}');
  });

  it('uses an idle timeout instead of one fixed deadline for the complete response body', async () => {
    const body = new Uint8Array([1, 2]);
    const model = testModel([{ path: 'config.json', body }]);
    const modelsDirectory = await createTemporaryDirectory();
    const target = join(modelsDirectory, model.code, model.revision);
    const fixedDeadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(fixedDeadline.signal);
    const fetchWithLongBody = (async (_input: string | URL | Request, init?: RequestInit) => {
      const signal = init?.signal;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(body.slice(0, 1));
            setTimeout(() => {
              fixedDeadline.abort();
              if (signal?.aborted) {
                controller.error(new Error('Fixed response deadline expired'));
                return;
              }
              controller.enqueue(body.slice(1));
              controller.close();
            }, 0);
          },
        }),
      );
    }) as typeof fetch;

    await new PinnedModelDownloader({ fetch: fetchWithLongBody }).download(
      model,
      target,
      async () => undefined,
    );

    expect(await verifyReadyModel(model, target)).toBe(true);
  });

  it('reports typed missing, size, and checksum failures during validation', async () => {
    const body = new Uint8Array([1, 2, 3]);
    const model = testModel([{ path: 'config.json', body }]);
    const modelsDirectory = await createTemporaryDirectory();
    const target = join(modelsDirectory, model.code, model.revision);
    const downloader = new PinnedModelDownloader({
      fetch: fakeFetch(model, new Map([['config.json', body]])),
    });
    await downloader.download(model, target, async () => undefined);

    await rm(join(target, 'config.json'));
    await expect(validateReadyModel(model, target)).rejects.toBeInstanceOf(ModelFileMissingError);

    await writeFile(join(target, 'config.json'), new Uint8Array([1, 2]));
    await expect(validateReadyModel(model, target)).rejects.toBeInstanceOf(ModelSizeMismatchError);

    await writeFile(join(target, 'config.json'), new Uint8Array([1, 2, 4]));
    await expect(validateReadyModel(model, target)).rejects.toBeInstanceOf(ModelHashMismatchError);
  });

  it('throws a typed timeout when a download request makes no progress', async () => {
    const body = new Uint8Array([1]);
    const model = testModel([{ path: 'config.json', body }]);
    const modelsDirectory = await createTemporaryDirectory();
    const target = join(modelsDirectory, model.code, model.revision);
    const stalledFetch = ((_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      })) as typeof fetch;

    await expect(
      new PinnedModelDownloader({
        fetch: stalledFetch,
        requestIdleTimeoutMilliseconds: 5,
      }).download(model, target, async () => undefined),
    ).rejects.toBeInstanceOf(ModelDownloadTimeoutError);
  });

  it('throws a typed network failure for an unsuccessful response', async () => {
    const body = new Uint8Array([1]);
    const model = testModel([{ path: 'missing.json', body }]);
    const modelsDirectory = await createTemporaryDirectory();
    const target = join(modelsDirectory, model.code, model.revision);

    await expect(
      new PinnedModelDownloader({
        fetch: fakeFetch(model, new Map()),
      }).download(model, target, async () => undefined),
    ).rejects.toBeInstanceOf(ModelDownloadNetworkError);
  });
});
