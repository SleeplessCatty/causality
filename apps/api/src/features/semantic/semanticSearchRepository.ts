import type { SemanticEntityType, SemanticModelCode } from '@causality/contracts';
import { MODEL_CATALOG } from '@causality/semantic-core';
import type { Pool } from 'pg';
import { toSql } from 'pgvector';

export interface SemanticCandidate {
  id: string;
  similarity: number;
}

export interface SemanticCandidateInput {
  entityType: SemanticEntityType;
  modelCode: SemanticModelCode;
  dimensions: 384 | 1024;
  threshold: number;
  vector: number[];
  limit: number;
}

export interface SemanticSearchRepository {
  candidates(input: SemanticCandidateInput): Promise<SemanticCandidate[]>;
}

interface CandidateRow {
  id: string;
  similarity: number;
}

export class PostgresSemanticSearchRepository implements SemanticSearchRepository {
  public constructor(private readonly pool: Pool) {}

  public async candidates(input: SemanticCandidateInput): Promise<SemanticCandidate[]> {
    const definition = MODEL_CATALOG[input.modelCode];
    if (
      input.dimensions !== definition.dimensions ||
      input.vector.length !== definition.dimensions ||
      input.vector.some((value) => !Number.isFinite(value))
    ) {
      throw new Error('Semantic query vector dimensions are invalid');
    }
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new Error('Semantic candidate limit must be between 1 and 100');
    }
    if (!Number.isFinite(input.threshold) || input.threshold < 0 || input.threshold > 100) {
      throw new Error('Semantic threshold must be between 0 and 100');
    }

    const vectorType = definition.dimensions === 384 ? 'vector(384)' : 'vector(1024)';
    const distance = `embedding::${vectorType} <=> $3::${vectorType}`;
    const result = await this.pool.query<CandidateRow>(
      `select entity_id as id,
              (1 - (${distance}))::float8 as similarity
       from semantic_embeddings
       where model_code = $1
         and entity_type = $2
         and 1 - (${distance}) >= $4
       order by ${distance}, entity_id
       limit $5`,
      [input.modelCode, input.entityType, toSql(input.vector), input.threshold / 100, input.limit],
    );
    return result.rows;
  }
}
