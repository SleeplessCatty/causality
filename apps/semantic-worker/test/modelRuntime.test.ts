import { MODEL_CATALOG } from '@causality/semantic-core';
import { describe, expect, it } from 'vitest';

import type {
  FeatureExtractionOptions,
  FeatureExtractionOutput,
  FeatureExtractionPipeline,
  TransformersBackend,
} from '../src/model/transformersRuntime.js';
import {
  configureTokenizerMaximum,
  TransformersEmbeddingRuntime,
} from '../src/model/transformersRuntime.js';

interface PipelineCall {
  text: string | readonly string[];
  options: FeatureExtractionOptions;
}

function fakeBackend(dimensions: number) {
  const calls: PipelineCall[] = [];
  let disposed = false;
  let active = 0;
  let maximumActive = 0;

  const pipeline = (async (
    text: string | readonly string[],
    options: FeatureExtractionOptions,
  ): Promise<FeatureExtractionOutput> => {
    calls.push({ text, options });
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await Promise.resolve();
    const count = typeof text === 'string' ? 1 : text.length;
    active -= 1;
    return {
      data: Float32Array.from({ length: count * dimensions }, (_, index) => index + 1),
      dims: [count, dimensions],
    };
  }) as FeatureExtractionPipeline;
  pipeline.dispose = async () => {
    disposed = true;
  };

  const loaded: Array<{ localPath: string; dtype: 'q8' }> = [];
  const backend: TransformersBackend = {
    configureLocalModels: () => undefined,
    createFeatureExtractionPipeline: async (localPath, dtype) => {
      loaded.push({ localPath, dtype });
      return pipeline;
    },
  };

  return {
    backend,
    calls,
    loaded,
    wasDisposed: () => disposed,
    maximumActive: () => maximumActive,
  };
}

describe('TransformersEmbeddingRuntime', () => {
  it('configures a getter-only tokenizer through its source configuration', () => {
    const tokenizer = {
      _tokenizerConfig: { model_max_length: 8_192 },
      get model_max_length() {
        return this._tokenizerConfig.model_max_length;
      },
    };

    configureTokenizerMaximum(tokenizer, 512);

    expect(tokenizer.model_max_length).toBe(512);
  });

  it('uses E5 prefixes, mean pooling, normalized output, and plain vectors', async () => {
    const fake = fakeBackend(384);
    const runtime = new TransformersEmbeddingRuntime({
      modelsDirectory: '/models',
      backend: fake.backend,
    });

    await runtime.load(MODEL_CATALOG['multilingual-e5-small'], '/models/e5/revision');
    const query = await runtime.embedQuery('政策利率提高');
    const documents = await runtime.embedDocuments(['融资成本上升']);

    expect(fake.loaded).toEqual([{ localPath: '/models/e5/revision', dtype: 'q8' }]);
    expect(fake.calls[0]).toMatchObject({
      text: 'query: 政策利率提高',
      options: {
        pooling: 'mean',
        normalize: true,
        truncation: true,
        max_length: 512,
      },
    });
    expect(fake.calls[1]).toMatchObject({
      text: ['passage: 融资成本上升'],
      options: {
        pooling: 'mean',
        normalize: true,
        truncation: true,
        max_length: 512,
      },
    });
    expect(query).toHaveLength(384);
    expect(Array.isArray(query)).toBe(true);
    expect(documents).toHaveLength(1);
    expect(documents[0]).toHaveLength(384);

    await runtime.dispose();
    expect(fake.wasDisposed()).toBe(true);
  });

  it('uses empty BGE-M3 prefixes with cls pooling', async () => {
    const fake = fakeBackend(1024);
    const runtime = new TransformersEmbeddingRuntime({
      modelsDirectory: '/models',
      backend: fake.backend,
    });

    await runtime.load(MODEL_CATALOG['bge-m3'], '/models/bge/revision');
    await runtime.embedQuery('央行政策');
    await runtime.embedDocuments(['市场流动性变化']);

    expect(fake.calls).toEqual([
      {
        text: '央行政策',
        options: {
          pooling: 'cls',
          normalize: true,
          truncation: true,
          max_length: 1024,
        },
      },
      {
        text: ['市场流动性变化'],
        options: {
          pooling: 'cls',
          normalize: true,
          truncation: true,
          max_length: 1024,
        },
      },
    ]);
  });

  it('serializes inference and rejects output with the wrong dimensions', async () => {
    const fake = fakeBackend(383);
    const runtime = new TransformersEmbeddingRuntime({
      modelsDirectory: '/models',
      backend: fake.backend,
    });
    await runtime.load(MODEL_CATALOG['multilingual-e5-small'], '/models/e5/revision');

    const first = runtime.embedQuery('第一条');
    const second = runtime.embedQuery('第二条');

    await expect(first).rejects.toThrow(/dimension/i);
    await expect(second).rejects.toThrow(/dimension/i);
    expect(fake.maximumActive()).toBe(1);
  });

  it('rejects inference before a model is loaded', async () => {
    const runtime = new TransformersEmbeddingRuntime({
      modelsDirectory: '/models',
      backend: fakeBackend(384).backend,
    });

    await expect(runtime.embedQuery('未加载')).rejects.toThrow(/not loaded/i);
  });
});
