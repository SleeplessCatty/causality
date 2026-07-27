import type { DataCheckSemanticReason } from '@causality/contracts';
import { MODEL_CATALOG } from '@causality/semantic-core';
import type { Pool } from 'pg';

import { PostgresSemanticLifecycleRepository } from '../semantic/semanticLifecycleRepository.js';
import type { SemanticWorkerClient } from '../semantic/semanticWorkerClient.js';
import type { DataCheckIssueDraft, DataCheckSemanticResult } from './dataCheckTypes.js';

const maximumSemanticIssues = 50_000;
const candidatesPerSource = 5;

interface SemanticPairRow {
  target_id: string;
  related_id: string;
  similarity: number;
  entity_type: 'event' | 'case';
}

export interface SemanticDuplicateRuleResult {
  issues: DataCheckIssueDraft[];
  semantic: DataCheckSemanticResult;
}

function skipped(
  reason: Exclude<
    DataCheckSemanticReason,
    null | 'not_recorded' | 'candidate_limit' | 'internal_failure'
  >,
): SemanticDuplicateRuleResult {
  return { issues: [], semantic: { status: 'skipped', reason, issueCount: 0 } };
}

function issueCopy(
  entityType: 'event' | 'case',
  similarity: number,
): Pick<DataCheckIssueDraft, 'description' | 'suggestion'> {
  const label = entityType === 'event' ? '原子事件' : '具体案例';
  return {
    description: `两个${label}的语义相似度为 ${Math.round(similarity * 100)}%，请人工确认是否重复。`,
    suggestion: `比较这两个${label}的内容后手动保留、合并或分别维护。`,
  };
}

function candidatePairCte(entityType: 'event' | 'case', dimensions: number): string {
  const prefix = entityType;
  const entityTypeParameter = entityType === 'event' ? '$2' : '$4';
  const sourceTable = entityType === 'event' ? 'abstract_events' : 'concrete_cases';
  const textColumn = entityType === 'event' ? 'normalized_name' : 'content';
  const vectorType = `vector(${dimensions})`;
  return `
    ${prefix}_sources as (
      select source.entity_id as source_id,
             source.embedding::${vectorType} as source_embedding,
             record.${textColumn} as source_text
      from semantic_embeddings as source
      join ${sourceTable} as record on record.id = source.entity_id
      where source.model_code = $1
        and source.entity_type = ${entityTypeParameter}
    ), ${prefix}_candidates as (
      select source.source_id,
             candidate.entity_id as candidate_id,
             candidate.similarity
      from ${prefix}_sources as source
      cross join lateral (
        select embedding.entity_id,
               1 - (embedding.embedding::${vectorType} <=> source.source_embedding) as similarity
        from semantic_embeddings as embedding
        join ${sourceTable} as record on record.id = embedding.entity_id
        where embedding.model_code = $1
          and embedding.entity_type = ${entityTypeParameter}
          and embedding.entity_id <> source.source_id
          and record.${textColumn} <> source.source_text
          and 1 - (embedding.embedding::${vectorType} <=> source.source_embedding) >= $3
        order by embedding.embedding::${vectorType} <=> source.source_embedding, embedding.entity_id
        limit ${candidatesPerSource}
      ) as candidate
    ), ${prefix}_pairs as (
      select least(source_id, candidate_id) as target_id,
             greatest(source_id, candidate_id) as related_id,
             max(similarity)::float8 as similarity
      from ${prefix}_candidates
      group by least(source_id, candidate_id), greatest(source_id, candidate_id)
    )
  `;
}

export function semanticCandidateSql(dimensions: number): string {
  return `
    with ${candidatePairCte('event', dimensions)},
         ${candidatePairCte('case', dimensions)}
    select target_id, related_id, similarity, 'event'::text as entity_type
    from event_pairs
    union all
    select target_id, related_id, similarity, 'case'::text as entity_type
    from case_pairs
    order by target_id, related_id, entity_type
    limit ${maximumSemanticIssues + 1}
  `;
}

export class SemanticDuplicateRule {
  private readonly lifecycleRepository: PostgresSemanticLifecycleRepository;

  public constructor(
    private readonly pool: Pool,
    private readonly workerClient: SemanticWorkerClient,
  ) {
    this.lifecycleRepository = new PostgresSemanticLifecycleRepository(pool);
  }

  public async scan(): Promise<SemanticDuplicateRuleResult> {
    const facts = await this.lifecycleRepository.readFacts();
    const modelCode = facts.index.currentModelCode;
    if (!modelCode) return skipped('no_active_model');

    const health = await this.workerClient.health().catch(() => null);
    if (!health) return skipped('worker_unreachable');
    if (facts.index.status !== 'ready' || health.activeModelCode !== modelCode) {
      return skipped('index_not_ready');
    }

    const model = facts.models.find((item) => item.modelCode === modelCode);
    if (!model) throw new Error('Active semantic model is missing from lifecycle facts');
    const embeddings = await this.pool.query<{ exists: boolean }>(
      `select exists (
         select 1
         from semantic_embeddings
         where model_code = $1
           and entity_type in ('event', 'case')
       ) as exists`,
      [modelCode],
    );
    if (!embeddings.rows[0]?.exists) return skipped('no_embeddings');

    const dimensions = MODEL_CATALOG[modelCode].dimensions;
    const threshold = model.dedupeThreshold / 100;
    const candidates = await this.pool.query<SemanticPairRow>(semanticCandidateSql(dimensions), [
      modelCode,
      'event',
      threshold,
      'case',
    ]);
    const pairs = candidates.rows;
    const truncated = pairs.length > maximumSemanticIssues;
    const retained = pairs.slice(0, maximumSemanticIssues);
    const issues = retained.map((pair) => {
      const copy = issueCopy(pair.entity_type, pair.similarity);
      return {
        severity: 'warning' as const,
        issueType: `semantic_duplicate_${pair.entity_type}`,
        targetType: pair.entity_type,
        targetId: pair.target_id,
        relatedId: pair.related_id,
        ...copy,
        actionMode: 'manual' as const,
      };
    });
    return {
      issues,
      semantic: {
        status: truncated ? 'truncated' : 'completed',
        reason: truncated ? 'candidate_limit' : null,
        issueCount: issues.length,
      },
    };
  }
}
