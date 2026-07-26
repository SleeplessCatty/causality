import type { SemanticEntityType } from '@causality/contracts';
import { buildSemanticDocument, hashSemanticDocument } from '@causality/semantic-core';
import type { Pool } from 'pg';

export interface SemanticSourceRecord {
  entityType: SemanticEntityType;
  entityId: string;
  document: string;
  sourceHash: string;
}

export interface SemanticSourceRepository {
  load(entityType: SemanticEntityType, entityId: string): Promise<SemanticSourceRecord | null>;
  loadBatch(
    entityType: SemanticEntityType,
    afterId: string | null,
    limit: number,
  ): Promise<SemanticSourceRecord[]>;
}

interface EventSourceRow {
  id: string;
  name: string;
  description: string | null;
  aliases: string[];
  keywords: string[];
}

interface RelationSourceRow {
  id: string;
  cause_event_name: string;
  effect_event_name: string;
  description: string | null;
}

interface CaseSourceRow {
  id: string;
  content: string;
}

function sourceRecord(
  entityType: SemanticEntityType,
  entityId: string,
  document: string,
): SemanticSourceRecord {
  return {
    entityType,
    entityId,
    document,
    sourceHash: hashSemanticDocument(document),
  };
}

export class PostgresSemanticSourceRepository implements SemanticSourceRepository {
  public constructor(private readonly pool: Pool) {}

  public async load(
    entityType: SemanticEntityType,
    entityId: string,
  ): Promise<SemanticSourceRecord | null> {
    const records = await this.query(entityType, null, 1, entityId);
    return records[0] ?? null;
  }

  public loadBatch(
    entityType: SemanticEntityType,
    afterId: string | null,
    limit: number,
  ): Promise<SemanticSourceRecord[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
      throw new Error('Semantic source batch limit must be between 1 and 1000');
    }
    return this.query(entityType, afterId, limit, null);
  }

  private async query(
    entityType: SemanticEntityType,
    afterId: string | null,
    limit: number,
    entityId: string | null,
  ): Promise<SemanticSourceRecord[]> {
    if (entityType === 'event') {
      const result = await this.pool.query<EventSourceRow>(
        `select event.id,
                event.name,
                event.description,
                coalesce(
                  (
                    select array_agg(alias.alias order by alias.normalized_alias, alias.id)
                    from event_aliases as alias
                    where alias.event_id = event.id
                  ),
                  array[]::varchar[]
                ) as aliases,
                coalesce(
                  (
                    select array_agg(keyword.keyword order by keyword.position, keyword.id)
                    from event_keywords as keyword
                    where keyword.event_id = event.id
                  ),
                  array[]::varchar[]
                ) as keywords
         from abstract_events as event
         where ($1::uuid is null or event.id > $1::uuid)
           and ($3::uuid is null or event.id = $3::uuid)
         order by event.id
         limit $2`,
        [afterId, limit, entityId],
      );
      return result.rows.map((row) => {
        const document = buildSemanticDocument({
          type: 'event',
          name: row.name,
          aliases: row.aliases,
          keywords: row.keywords,
          description: row.description,
        });
        return sourceRecord('event', row.id, document);
      });
    }

    if (entityType === 'relation') {
      const result = await this.pool.query<RelationSourceRow>(
        `select relation.id,
                cause.name as cause_event_name,
                effect.name as effect_event_name,
                relation.description
         from causal_relations as relation
         join abstract_events as cause
           on cause.id = relation.cause_event_id
         join abstract_events as effect
           on effect.id = relation.effect_event_id
         where ($1::uuid is null or relation.id > $1::uuid)
           and ($3::uuid is null or relation.id = $3::uuid)
         order by relation.id
         limit $2`,
        [afterId, limit, entityId],
      );
      return result.rows.map((row) => {
        const document = buildSemanticDocument({
          type: 'relation',
          causeEventName: row.cause_event_name,
          effectEventName: row.effect_event_name,
          description: row.description,
        });
        return sourceRecord('relation', row.id, document);
      });
    }

    const result = await this.pool.query<CaseSourceRow>(
      `select concrete_case.id,
              concrete_case.content
       from concrete_cases as concrete_case
       where ($1::uuid is null or concrete_case.id > $1::uuid)
         and ($3::uuid is null or concrete_case.id = $3::uuid)
       order by concrete_case.id
       limit $2`,
      [afterId, limit, entityId],
    );
    return result.rows.map((row) => {
      const document = buildSemanticDocument({
        type: 'case',
        content: row.content,
      });
      return sourceRecord('case', row.id, document);
    });
  }
}
