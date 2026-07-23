import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import type { SemanticModelDefinition } from '@causality/semantic-core';
import { afterEach, describe, expect, it } from 'vitest';

import { PinnedModelDownloader, verifyReadyModel } from '../src/model/modelDownloader.js';

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

    await expect(downloader.download(model, target, async () => undefined)).rejects.toThrow(
      /checksum/i,
    );

    await expect(access(join(modelsDirectory, '.partial', model.code))).rejects.toThrow();
    await expect(readFile(existingReadyMarker, 'utf8')).resolves.toBe('{"ready":true}');
  });
});
