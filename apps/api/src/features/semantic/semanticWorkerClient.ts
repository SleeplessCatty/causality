import {
  semanticModelCodeSchema,
  type ApiErrorCode,
  type SemanticModelCode,
} from '@causality/contracts';
import { MODEL_CATALOG } from '@causality/semantic-core';
import { z } from 'zod';

const embeddingResponseSchema = z
  .object({
    modelCode: semanticModelCodeSchema,
    dimensions: z.union([z.literal(384), z.literal(512), z.literal(1024)]),
    vector: z.array(z.number().finite()),
  })
  .strict();

const healthResponseSchema = z
  .object({
    status: z.literal('ok'),
    modelLoaded: z.boolean(),
    activeModelCode: semanticModelCodeSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.modelLoaded !== (value.activeModelCode !== null)) {
      context.addIssue({
        code: 'custom',
        message: 'Worker model state is inconsistent',
      });
    }
  });

export type SemanticWorkerHealth = z.infer<typeof healthResponseSchema>;

export interface SemanticWorkerClient {
  health(): Promise<SemanticWorkerHealth>;
  embedQuery(modelCode: SemanticModelCode, text: string): Promise<number[]>;
}

export class SemanticWorkerClientError extends Error {
  public readonly code: Extract<ApiErrorCode, 'SEMANTIC_WORKER_UNAVAILABLE'> =
    'SEMANTIC_WORKER_UNAVAILABLE';

  public constructor() {
    super('语义服务暂不可用');
    this.name = 'SemanticWorkerClientError';
  }
}

interface HttpSemanticWorkerClientOptions {
  baseUrl: string;
  timeoutMs: number;
  fetchFn?: typeof fetch;
}

export class HttpSemanticWorkerClient implements SemanticWorkerClient {
  private readonly fetchFn: typeof fetch;
  private readonly embeddingEndpoint: string;
  private readonly healthEndpoint: string;

  public constructor(private readonly options: HttpSemanticWorkerClientOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.embeddingEndpoint = new URL('/internal/embed-query', options.baseUrl).toString();
    this.healthEndpoint = new URL('/internal/health', options.baseUrl).toString();
  }

  public async health(): Promise<SemanticWorkerHealth> {
    try {
      const response = await this.fetchFn(this.healthEndpoint, {
        method: 'GET',
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
      if (!response.ok) throw new SemanticWorkerClientError();

      const parsed = healthResponseSchema.safeParse(await response.json());
      if (!parsed.success) throw new SemanticWorkerClientError();
      return parsed.data;
    } catch (error) {
      if (error instanceof SemanticWorkerClientError) throw error;
      throw new SemanticWorkerClientError();
    }
  }

  public async embedQuery(modelCode: SemanticModelCode, text: string): Promise<number[]> {
    try {
      const response = await this.fetchFn(this.embeddingEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ modelCode, text }),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
      if (!response.ok) throw new SemanticWorkerClientError();

      const parsed = embeddingResponseSchema.safeParse(await response.json());
      const definition = MODEL_CATALOG[modelCode];
      if (
        !parsed.success ||
        parsed.data.modelCode !== modelCode ||
        parsed.data.dimensions !== definition.dimensions ||
        parsed.data.vector.length !== definition.dimensions
      ) {
        throw new SemanticWorkerClientError();
      }
      return parsed.data.vector;
    } catch (error) {
      if (error instanceof SemanticWorkerClientError) throw error;
      throw new SemanticWorkerClientError();
    }
  }
}
