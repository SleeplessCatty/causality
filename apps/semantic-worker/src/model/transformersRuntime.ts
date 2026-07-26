import { isAbsolute, relative, resolve, sep } from 'node:path';

import type { SemanticModelDefinition } from '@causality/semantic-core';

import type { EmbeddingRuntime } from './modelRuntime.js';

export interface FeatureExtractionOptions {
  pooling: 'mean' | 'cls';
  normalize: true;
  truncation: true;
  max_length: number;
}

export interface FeatureExtractionOutput {
  data: ArrayLike<number>;
  dims: readonly number[];
  dispose(): void;
}

export interface FeatureExtractionPipeline {
  (
    text: string | readonly string[],
    options: FeatureExtractionOptions,
  ): Promise<FeatureExtractionOutput>;
  dispose(): Promise<void>;
}

export interface FeatureExtractionSessionOptions {
  enableCpuMemArena: false;
  enableMemPattern: false;
  executionMode: 'sequential';
  interOpNumThreads: 1;
  intraOpNumThreads: 2;
}

export interface TransformersBackend {
  configureLocalModels(modelsDirectory: string): void | Promise<void>;
  createFeatureExtractionPipeline(
    localPath: string,
    dtype: 'q8',
    maxTokens: number,
    sessionOptions: FeatureExtractionSessionOptions,
  ): Promise<FeatureExtractionPipeline>;
}

interface ConfigurableTokenizer {
  _tokenizerConfig: {
    model_max_length?: number;
  };
}

export function configureTokenizerMaximum(
  tokenizer: ConfigurableTokenizer,
  maxTokens: number,
): void {
  tokenizer._tokenizerConfig.model_max_length = maxTokens;
}

class LocalTransformersBackend implements TransformersBackend {
  private modelsDirectory: string | undefined;

  public configureLocalModels(modelsDirectory: string): void {
    this.modelsDirectory = resolve(modelsDirectory);
  }

  public async createFeatureExtractionPipeline(
    localPath: string,
    dtype: 'q8',
    maxTokens: number,
    sessionOptions: FeatureExtractionSessionOptions,
  ): Promise<FeatureExtractionPipeline> {
    if (!this.modelsDirectory) throw new Error('Transformers backend is not configured');
    const relativeModelPath = relative(this.modelsDirectory, resolve(localPath));
    if (
      relativeModelPath === '..' ||
      relativeModelPath.startsWith(`..${sep}`) ||
      isAbsolute(relativeModelPath)
    ) {
      throw new Error('Model path must be inside the configured model directory');
    }

    const transformers = await import('@huggingface/transformers');
    transformers.env.allowRemoteModels = false;
    transformers.env.allowLocalModels = true;
    transformers.env.localModelPath = this.modelsDirectory;
    transformers.env.useFSCache = false;

    const extractor = await transformers.pipeline(
      'feature-extraction',
      relativeModelPath.split(sep).join('/'),
      {
        dtype,
        local_files_only: true,
        session_options: sessionOptions,
      },
    );
    configureTokenizerMaximum(extractor.tokenizer, maxTokens);

    const wrapped = (async (text: string | readonly string[], options: FeatureExtractionOptions) =>
      extractor(text as string | string[], options)) as unknown as FeatureExtractionPipeline;
    wrapped.dispose = async () => {
      await extractor.dispose();
    };
    return wrapped;
  }
}

interface TransformersEmbeddingRuntimeOptions {
  modelsDirectory: string;
  backend?: TransformersBackend;
}

export class ModelLoadTransientError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ModelLoadTransientError';
  }
}

export class ModelRuntimeIncompatibleError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ModelRuntimeIncompatibleError';
  }
}

export class ModelMemoryInsufficientError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ModelMemoryInsufficientError';
  }
}

export class TransformersEmbeddingRuntime implements EmbeddingRuntime {
  private readonly backend: TransformersBackend;
  private pipeline: FeatureExtractionPipeline | undefined;
  private model: SemanticModelDefinition | undefined;
  private inferenceTail: Promise<void> = Promise.resolve();

  public constructor(private readonly options: TransformersEmbeddingRuntimeOptions) {
    this.backend = options.backend ?? new LocalTransformersBackend();
  }

  public async load(model: SemanticModelDefinition, localPath: string): Promise<void> {
    await this.inferenceTail;
    await this.disposePipeline();
    await this.backend.configureLocalModels(this.options.modelsDirectory);
    this.pipeline = await this.backend.createFeatureExtractionPipeline(
      localPath,
      model.dtype,
      model.maxTokens,
      {
        enableCpuMemArena: false,
        enableMemPattern: false,
        executionMode: 'sequential',
        interOpNumThreads: 1,
        intraOpNumThreads: 2,
      },
    );
    this.model = model;
  }

  public embedQuery(text: string): Promise<number[]> {
    return this.schedule(async () => {
      const { model, pipeline } = this.loaded();
      const output = await pipeline(`${model.queryPrefix}${text}`, this.optionsFor(model));
      try {
        return this.copyVectors(output, 1, model.dimensions)[0]!;
      } finally {
        output.dispose();
      }
    });
  }

  public embedDocuments(texts: readonly string[]): Promise<number[][]> {
    if (texts.length === 0) return Promise.resolve([]);
    return this.schedule(async () => {
      const { model, pipeline } = this.loaded();
      const output = await pipeline(
        texts.map((text) => `${model.documentPrefix}${text}`),
        this.optionsFor(model),
      );
      try {
        return this.copyVectors(output, texts.length, model.dimensions);
      } finally {
        output.dispose();
      }
    });
  }

  public async dispose(): Promise<void> {
    await this.inferenceTail;
    await this.disposePipeline();
  }

  private loaded(): {
    model: SemanticModelDefinition;
    pipeline: FeatureExtractionPipeline;
  } {
    if (!this.model || !this.pipeline) throw new Error('Semantic model is not loaded');
    return { model: this.model, pipeline: this.pipeline };
  }

  private optionsFor(model: SemanticModelDefinition): FeatureExtractionOptions {
    return {
      pooling: model.pooling,
      normalize: true,
      truncation: true,
      max_length: model.maxTokens,
    };
  }

  private copyVectors(
    output: FeatureExtractionOutput,
    count: number,
    dimensions: number,
  ): number[][] {
    if (
      output.dims.length !== 2 ||
      output.dims[0] !== count ||
      output.dims[1] !== dimensions ||
      output.data.length !== count * dimensions
    ) {
      throw new Error(
        `Semantic embedding dimension mismatch: expected ${count}x${dimensions}, received ${output.dims.join('x')}`,
      );
    }

    return Array.from({ length: count }, (_, index) => {
      const start = index * dimensions;
      const vector = Array.from(
        { length: dimensions },
        (_unused, dimension) => output.data[start + dimension]!,
      );
      if (vector.some((value) => !Number.isFinite(value))) {
        throw new Error('Semantic embedding contains a non-finite value');
      }
      return vector;
    });
  }

  private schedule<T>(operation: () => Promise<T>): Promise<T> {
    const scheduled = this.inferenceTail.then(operation, operation);
    this.inferenceTail = scheduled.then(
      () => undefined,
      () => undefined,
    );
    return scheduled;
  }

  private async disposePipeline(): Promise<void> {
    const pipeline = this.pipeline;
    this.pipeline = undefined;
    this.model = undefined;
    if (pipeline) await pipeline.dispose();
  }
}
