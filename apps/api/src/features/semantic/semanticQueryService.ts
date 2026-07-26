import type {
  ApiErrorCode,
  SemanticEntityType,
  SemanticIndexStatus,
  SemanticIndexNotice,
  SemanticModelCode,
  SemanticModelFileStatus,
} from '@causality/contracts';
import { MODEL_CATALOG } from '@causality/semantic-core';
import type { Pool } from 'pg';

import type { SemanticSearchRepository } from './semanticSearchRepository.js';
import { SemanticWorkerClientError, type SemanticWorkerClient } from './semanticWorkerClient.js';

export interface SemanticQueryContext {
  modelCode: SemanticModelCode | null;
  status: SemanticIndexStatus;
  threshold: number | null;
  fileState: SemanticModelFileStatus | null;
}

export interface SemanticQueryContextRepository {
  activeContext(): Promise<SemanticQueryContext>;
}

export interface SemanticCandidateIds {
  ids: string[];
  semanticIndexNotice: SemanticIndexNotice;
}

export type SemanticQueryErrorCode = Extract<
  ApiErrorCode,
  | 'SEMANTIC_QUERY_EMPTY'
  | 'SEMANTIC_MODEL_UNAVAILABLE'
  | 'SEMANTIC_MODEL_DOWNLOADING'
  | 'SEMANTIC_INDEX_BUILDING'
  | 'SEMANTIC_INDEX_FAILED'
  | 'SEMANTIC_WORKER_UNAVAILABLE'
>;

const semanticErrorMessages: Record<SemanticQueryErrorCode, string> = {
  SEMANTIC_QUERY_EMPTY: '请先输入搜索内容',
  SEMANTIC_MODEL_UNAVAILABLE: '尚未下载并使用语义模型',
  SEMANTIC_MODEL_DOWNLOADING: '模型正在下载，增强查询暂不可用',
  SEMANTIC_INDEX_BUILDING: '语义索引正在生成，增强查询暂不可用',
  SEMANTIC_INDEX_FAILED: '语义索引生成失败',
  SEMANTIC_WORKER_UNAVAILABLE: '语义服务暂不可用',
};

export class SemanticQueryError extends Error {
  public constructor(public readonly code: SemanticQueryErrorCode) {
    super(semanticErrorMessages[code]);
    this.name = 'SemanticQueryError';
  }
}

export function semanticQueryErrorStatus(error: SemanticQueryError): 400 | 409 | 503 {
  if (error.code === 'SEMANTIC_QUERY_EMPTY') return 400;
  if (error.code === 'SEMANTIC_WORKER_UNAVAILABLE') return 503;
  return 409;
}

interface ContextRow {
  model_code: SemanticModelCode | null;
  status: SemanticIndexStatus;
  threshold: number | null;
  file_status: SemanticModelFileStatus | null;
}

export class PostgresSemanticQueryContextRepository implements SemanticQueryContextRepository {
  public constructor(private readonly pool: Pool) {}

  public async activeContext(): Promise<SemanticQueryContext> {
    const result = await this.pool.query<ContextRow>(
      `select state.active_model_code as model_code,
              state.status,
              settings.threshold,
              settings.file_status
       from semantic_index_state as state
       left join semantic_model_settings as settings
         on settings.model_code = state.active_model_code
       where state.singleton_key = true`,
    );
    const row = result.rows[0];
    if (!row) throw new Error('Missing semantic_index_state singleton');
    return {
      modelCode: row.model_code,
      status: row.status,
      threshold: row.threshold,
      fileState: row.file_status,
    };
  }
}

interface SemanticQueryServiceOptions {
  contextRepository: SemanticQueryContextRepository;
  workerClient: SemanticWorkerClient;
  searchRepository: SemanticSearchRepository;
}

export class SemanticQueryService {
  public constructor(private readonly options: SemanticQueryServiceOptions) {}

  public async candidateIds(
    entityType: SemanticEntityType,
    query: string,
  ): Promise<SemanticCandidateIds> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) throw new SemanticQueryError('SEMANTIC_QUERY_EMPTY');

    const context = await this.options.contextRepository.activeContext();
    this.assertUsable(context);
    const modelCode = context.modelCode!;
    const definition = MODEL_CATALOG[modelCode];

    try {
      const vector = await this.options.workerClient.embedQuery(modelCode, normalizedQuery);
      const candidates = await this.options.searchRepository.candidates({
        entityType,
        modelCode,
        dimensions: definition.dimensions,
        threshold: context.threshold!,
        vector,
        limit: 100,
      });
      return {
        ids: candidates.map((candidate) => candidate.id),
        semanticIndexNotice:
          context.status === 'updating'
            ? 'updating'
            : context.status === 'incomplete'
              ? 'incomplete'
              : null,
      };
    } catch (error) {
      if (error instanceof SemanticWorkerClientError) {
        throw new SemanticQueryError('SEMANTIC_WORKER_UNAVAILABLE');
      }
      throw error;
    }
  }

  private assertUsable(context: SemanticQueryContext): asserts context is SemanticQueryContext & {
    modelCode: SemanticModelCode;
    threshold: number;
  } {
    if (!context.modelCode || context.status === 'empty') {
      throw new SemanticQueryError('SEMANTIC_MODEL_UNAVAILABLE');
    }
    if (context.status === 'waiting_model') {
      throw new SemanticQueryError('SEMANTIC_MODEL_DOWNLOADING');
    }
    if (
      context.status === 'loading' ||
      context.status === 'index_queued' ||
      context.status === 'building'
    ) {
      throw new SemanticQueryError('SEMANTIC_INDEX_BUILDING');
    }
    if (context.status === 'failed') {
      throw new SemanticQueryError('SEMANTIC_INDEX_FAILED');
    }
    if (context.fileState !== 'downloaded' || context.threshold === null) {
      throw new SemanticQueryError('SEMANTIC_MODEL_UNAVAILABLE');
    }
  }
}
