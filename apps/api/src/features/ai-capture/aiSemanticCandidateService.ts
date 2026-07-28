import type {
  SemanticEntityType,
  SemanticModelCode,
  SemanticModelFileStatus,
} from '@causality/contracts';
import { MODEL_CATALOG, type SemanticVectorDimensions } from '@causality/semantic-core';
import type { Pool } from 'pg';
import { toSql } from 'pgvector';

import {
  SemanticQueryError,
  type SemanticQueryContext,
  type SemanticQueryContextRepository,
} from '../semantic/semanticQueryService.js';
import {
  SemanticWorkerClientError,
  type SemanticWorkerClient,
} from '../semantic/semanticWorkerClient.js';

const QUERY_CHUNK_SIZE = 64;
const MAX_CONCURRENT_CHUNKS = 2;
const MAX_MATCHES = 10;

export interface SemanticMatch {
  id: string;
  similarity: number;
}

interface CandidateRow {
  input_index: number;
  id: string | null;
  similarity: number | null;
}

interface AiSemanticCandidateServiceOptions {
  contextRepository: SemanticQueryContextRepository;
  workerClient: SemanticWorkerClient;
  pool: Pool;
}

interface QueryChunk {
  index: number;
  texts: readonly string[];
}

export class AiSemanticCandidateService {
  public constructor(private readonly options: AiSemanticCandidateServiceOptions) {}

  public async compare(
    entityType: Extract<SemanticEntityType, 'event' | 'case'>,
    texts: readonly string[],
  ): Promise<SemanticMatch[][]> {
    if (texts.length === 0) return [];

    const context = await this.options.contextRepository.activeContext();
    this.assertReady(context);

    const chunks = this.createChunks(texts);
    const chunkResults = new Array<SemanticMatch[][]>(chunks.length);
    let nextChunk = 0;
    const processNext = async (): Promise<void> => {
      while (nextChunk < chunks.length) {
        const chunk = chunks[nextChunk++]!;
        chunkResults[chunk.index] = await this.compareChunk(
          entityType,
          context.modelCode,
          chunk.texts,
        );
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(MAX_CONCURRENT_CHUNKS, chunks.length) }, () => processNext()),
    );
    return chunkResults.flat();
  }

  private assertReady(
    context: SemanticQueryContext,
  ): asserts context is SemanticQueryContext & { modelCode: SemanticModelCode } {
    if (!context.modelCode || context.status === 'empty') {
      throw new SemanticQueryError('SEMANTIC_MODEL_UNAVAILABLE');
    }
    if (context.status === 'waiting_model') {
      throw new SemanticQueryError('SEMANTIC_MODEL_DOWNLOADING');
    }
    if (
      context.status === 'loading' ||
      context.status === 'index_queued' ||
      context.status === 'building' ||
      context.status === 'updating'
    ) {
      throw new SemanticQueryError('SEMANTIC_INDEX_BUILDING');
    }
    if (context.status === 'incomplete' || context.status === 'failed') {
      throw new SemanticQueryError('SEMANTIC_INDEX_FAILED');
    }
    if (context.status !== 'ready') {
      throw new SemanticQueryError('SEMANTIC_MODEL_UNAVAILABLE');
    }
    this.assertDownloadedFile(context.fileState);
  }

  private assertDownloadedFile(fileState: SemanticModelFileStatus | null): void {
    if (
      fileState === 'download_queued' ||
      fileState === 'downloading' ||
      fileState === 'verifying'
    ) {
      throw new SemanticQueryError('SEMANTIC_MODEL_DOWNLOADING');
    }
    if (fileState === 'invalid' || fileState === 'failed') {
      throw new SemanticQueryError('SEMANTIC_INDEX_FAILED');
    }
    if (fileState !== 'downloaded') {
      throw new SemanticQueryError('SEMANTIC_MODEL_UNAVAILABLE');
    }
  }

  private createChunks(texts: readonly string[]): QueryChunk[] {
    const chunks: QueryChunk[] = [];
    for (let offset = 0; offset < texts.length; offset += QUERY_CHUNK_SIZE) {
      chunks.push({
        index: chunks.length,
        texts: texts.slice(offset, offset + QUERY_CHUNK_SIZE),
      });
    }
    return chunks;
  }

  private async compareChunk(
    entityType: Extract<SemanticEntityType, 'event' | 'case'>,
    modelCode: SemanticModelCode,
    texts: readonly string[],
  ): Promise<SemanticMatch[][]> {
    let vectors: number[][];
    try {
      vectors = await this.options.workerClient.embedQueries(modelCode, texts);
    } catch (error) {
      if (error instanceof SemanticWorkerClientError) {
        throw new SemanticQueryError('SEMANTIC_WORKER_UNAVAILABLE');
      }
      throw error;
    }

    const dimensions = MODEL_CATALOG[modelCode].dimensions;
    this.assertVectors(vectors, texts.length, dimensions);
    return this.findMatches(entityType, modelCode, dimensions, vectors);
  }

  private assertVectors(
    vectors: readonly number[][],
    expectedCount: number,
    dimensions: SemanticVectorDimensions,
  ): void {
    if (
      vectors.length !== expectedCount ||
      vectors.some(
        (vector) => vector.length !== dimensions || vector.some((value) => !Number.isFinite(value)),
      )
    ) {
      throw new SemanticQueryError('SEMANTIC_WORKER_UNAVAILABLE');
    }
  }

  private async findMatches(
    entityType: Extract<SemanticEntityType, 'event' | 'case'>,
    modelCode: SemanticModelCode,
    dimensions: SemanticVectorDimensions,
    vectors: readonly number[][],
  ): Promise<SemanticMatch[][]> {
    const vectorType = `vector(${dimensions})`;
    const distance = `embedding.embedding::${vectorType} <=> input.embedding::${vectorType}`;
    const result = await this.options.pool.query<CandidateRow>(
      `select input."inputIndex" as input_index,
              candidate.id,
              candidate.similarity
       from jsonb_to_recordset($3::jsonb)
         as input("inputIndex" integer, embedding text)
       left join lateral (
         select embedding.entity_id as id,
                (1 - (${distance}))::float8 as similarity
         from semantic_embeddings as embedding
         where embedding.model_code = $1
           and embedding.entity_type = $2
         order by ${distance}, embedding.entity_id
         limit ${MAX_MATCHES}
       ) as candidate on true
       order by input."inputIndex", candidate.similarity desc nulls last, candidate.id`,
      [
        modelCode,
        entityType,
        JSON.stringify(
          vectors.map((vector, inputIndex) => ({
            inputIndex,
            embedding: toSql(vector),
          })),
        ),
      ],
    );

    const matches = Array.from({ length: vectors.length }, () => [] as SemanticMatch[]);
    for (const row of result.rows) {
      if (
        row.id === null ||
        row.similarity === null ||
        row.input_index < 0 ||
        row.input_index >= matches.length
      ) {
        continue;
      }
      const target = matches[row.input_index]!;
      if (target.length < MAX_MATCHES) {
        target.push({ id: row.id, similarity: row.similarity });
      }
    }
    return matches;
  }
}
