import { join } from 'node:path';

import { semanticModelCodeSchema } from '@causality/contracts';
import {
  MODEL_CATALOG,
  type SemanticModelCode,
  type SemanticVectorDimensions,
} from '@causality/semantic-core';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { z } from 'zod';

import { classifySemanticFailure } from './jobs/failureClassifier.js';
import type { ModelFileRepository } from './jobs/jobTypes.js';
import type { EmbeddingRuntime } from './model/modelRuntime.js';
import {
  ModelHashMismatchError,
  removeModelVersion,
  validateReadyModel,
} from './model/modelDownloader.js';

const embedQuerySchema = z
  .object({
    modelCode: semanticModelCodeSchema,
    text: z.string().trim().min(1).max(200),
  })
  .strict();

export interface SemanticWorkerHealth {
  status: 'ok';
  modelLoaded: boolean;
  activeModelCode: SemanticModelCode | null;
}

export interface QueryEmbeddingResult {
  modelCode: SemanticModelCode;
  dimensions: SemanticVectorDimensions;
  vector: number[];
}

export interface SemanticWorkerQueryService {
  health(): SemanticWorkerHealth;
  embedQuery(modelCode: SemanticModelCode, text: string): Promise<QueryEmbeddingResult>;
}

export class ActiveModelMismatchError extends Error {
  public constructor() {
    super('Requested semantic model is not the active loaded model');
    this.name = 'ActiveModelMismatchError';
  }
}

interface SemanticWorkerServiceOptions {
  repository: ModelFileRepository;
  runtime: EmbeddingRuntime;
  modelsDirectory: string;
  validateModel?: typeof validateReadyModel;
}

export class SemanticWorkerService implements SemanticWorkerQueryService {
  private readonly validateModel: typeof validateReadyModel;
  private activeModelCode: SemanticModelCode | null = null;

  public constructor(private readonly options: SemanticWorkerServiceOptions) {
    this.validateModel = options.validateModel ?? validateReadyModel;
  }

  public async initialize(): Promise<void> {
    const active = await this.options.repository.findReadyActiveModel();
    if (!active) return;

    const model = MODEL_CATALOG[active.modelCode];
    const target = join(this.options.modelsDirectory, model.code, model.revision);
    try {
      if (active.revision !== model.revision) {
        throw new ModelHashMismatchError('READY.json');
      }
      await this.validateModel(model, target);
    } catch (error) {
      const failure = classifySemanticFailure('verify', error);
      await this.options.runtime.dispose();
      await removeModelVersion(model, target);
      await this.options.repository.invalidateActiveModel(model.code, failure);
      return;
    }

    try {
      await this.options.runtime.load(model, target);
      this.activeModelCode = model.code;
    } catch (error) {
      await this.options.runtime.dispose();
      await this.options.repository.failActiveModelLoad(
        model.code,
        classifySemanticFailure('load', error),
      );
    }
  }

  public health(): SemanticWorkerHealth {
    return {
      status: 'ok',
      modelLoaded: this.activeModelCode !== null,
      activeModelCode: this.activeModelCode,
    };
  }

  public markModelLoading(): void {
    this.activeModelCode = null;
  }

  public markLoadedModel(modelCode: SemanticModelCode): void {
    this.activeModelCode = modelCode;
  }

  public async embedQuery(
    modelCode: SemanticModelCode,
    text: string,
  ): Promise<QueryEmbeddingResult> {
    if (modelCode !== this.activeModelCode) throw new ActiveModelMismatchError();
    const model = MODEL_CATALOG[modelCode];
    const vector = await this.options.runtime.embedQuery(text);
    return {
      modelCode,
      dimensions: model.dimensions,
      vector,
    };
  }

  public dispose(): Promise<void> {
    this.activeModelCode = null;
    return this.options.runtime.dispose();
  }
}

interface BuildInternalServerOptions {
  service: SemanticWorkerQueryService;
  logger?: FastifyServerOptions['logger'];
}

export function buildInternalServer(options: BuildInternalServerOptions): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 4 * 1024,
  });

  app.get('/internal/health', async () => options.service.health());
  app.post('/internal/embed-query', async (request, reply) => {
    const parsed = embedQuerySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: '请求参数无效',
      });
    }
    try {
      return await options.service.embedQuery(parsed.data.modelCode, parsed.data.text);
    } catch (error) {
      if (error instanceof ActiveModelMismatchError) {
        return reply.status(409).send({
          code: 'SEMANTIC_MODEL_UNAVAILABLE',
          message: '请求的语义模型当前未加载',
        });
      }
      throw error;
    }
  });

  return app;
}
