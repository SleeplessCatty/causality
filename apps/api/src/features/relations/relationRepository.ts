import type {
  RelationDetail,
  RelationFormInput,
  RelationListQuery,
  RelationListResponse,
  RelationPairCheckQuery,
  RelationPairCheckResponse,
  RelationReference,
  RelationSummary,
} from '@causality/contracts';
import type { Pool } from 'pg';

import { decodeRelationCursor, encodeRelationCursor } from './relationCursor.js';

interface RelationRow {
  id: string;
  cause_event_id: string;
  cause_event_name: string;
  effect_event_id: string;
  effect_event_name: string;
  confidence: number;
  description: string | null;
  created_at: Date;
  updated_at: Date;
  rank?: number;
}

export interface RelationRepository {
  list(query: RelationListQuery): Promise<RelationListResponse>;
  checkPair(query: RelationPairCheckQuery): Promise<RelationPairCheckResponse>;
  findById(id: string): Promise<RelationDetail | null>;
  create(input: RelationFormInput): Promise<RelationDetail>;
  replace(id: string, input: RelationFormInput): Promise<RelationDetail | null>;
}

function normalizeQuery(query: string): string {
  return query.trim().toLocaleLowerCase();
}

function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

function reference(row: RelationRow): RelationReference {
  return {
    id: row.id,
    causeEvent: { id: row.cause_event_id, name: row.cause_event_name },
    effectEvent: { id: row.effect_event_id, name: row.effect_event_name },
  };
}

function summary(row: RelationRow): RelationSummary {
  return {
    ...reference(row),
    confidence: row.confidence,
    caseCount: 0,
    updatedAt: row.updated_at.toISOString(),
  };
}

function detail(row: RelationRow): RelationDetail {
  return {
    ...summary(row),
    description: row.description,
    createdAt: row.created_at.toISOString(),
  };
}

const selectRelation = `select r.id,
                               r.cause_event_id,
                               cause.name as cause_event_name,
                               r.effect_event_id,
                               effect.name as effect_event_name,
                               r.confidence,
                               r.description,
                               r.created_at,
                               r.updated_at
                        from causal_relations r
                        join abstract_events cause on cause.id = r.cause_event_id
                        join abstract_events effect on effect.id = r.effect_event_id`;

export class PostgresRelationRepository implements RelationRepository {
  constructor(private readonly pool: Pool) {}

  async list(query: RelationListQuery): Promise<RelationListResponse> {
    const normalizedQuery = normalizeQuery(query.q);
    const cursor = query.cursor ? decodeRelationCursor(query.cursor, normalizedQuery) : undefined;
    const rowsWithExtra = normalizedQuery
      ? await this.searchRows(normalizedQuery, query.limit + 1, cursor)
      : await this.listRows(query.limit + 1, cursor);
    const hasMore = rowsWithExtra.length > query.limit;
    const rows = rowsWithExtra.slice(0, query.limit);
    const last = rows.at(-1);
    return {
      items: rows.map(summary),
      hasMore,
      nextCursor:
        hasMore && last
          ? encodeRelationCursor({
              query: normalizedQuery,
              rank: normalizedQuery ? last.rank! : null,
              updatedAt: last.updated_at.toISOString(),
              id: last.id,
            })
          : null,
    };
  }

  private async listRows(
    limit: number,
    cursor?: ReturnType<typeof decodeRelationCursor>,
  ): Promise<RelationRow[]> {
    const parameters: unknown[] = [];
    const condition = cursor ? `where (r.updated_at, r.id) < ($1::timestamptz, $2::uuid)` : '';
    if (cursor) parameters.push(cursor.updatedAt, cursor.id);
    parameters.push(limit);
    const result = await this.pool.query<RelationRow>(
      `${selectRelation}
       ${condition}
       order by r.updated_at desc, r.id desc
       limit $${parameters.length}`,
      parameters,
    );
    return result.rows;
  }

  private async searchRows(
    query: string,
    limit: number,
    cursor?: ReturnType<typeof decodeRelationCursor>,
  ): Promise<RelationRow[]> {
    const escaped = escapeLike(query);
    const parameters: unknown[] = [query, `${escaped}%`, `%${escaped}%`];
    const cursorCondition = cursor
      ? `and (
           ranked.rank > $4::int
           or (ranked.rank = $4::int
               and (ranked.updated_at, ranked.id) < ($5::timestamptz, $6::uuid))
         )`
      : '';
    if (cursor) parameters.push(cursor.rank, cursor.updatedAt, cursor.id);
    parameters.push(limit);

    const result = await this.pool.query<RelationRow>(
      `with ranked as (
         select r.id,
                r.cause_event_id,
                cause.name as cause_event_name,
                r.effect_event_id,
                effect.name as effect_event_name,
                r.confidence,
                r.description,
                r.created_at,
                r.updated_at,
                case
                  when cause.normalized_name = $1 or effect.normalized_name = $1 then 1
                  when cause.normalized_name like $2 escape '\\'
                    or effect.normalized_name like $2 escape '\\' then 2
                  when exists (
                    select 1 from event_aliases a
                    where a.event_id in (r.cause_event_id, r.effect_event_id)
                      and a.normalized_alias = $1
                  ) then 3
                  when exists (
                    select 1 from event_aliases a
                    where a.event_id in (r.cause_event_id, r.effect_event_id)
                      and a.normalized_alias like $2 escape '\\'
                  ) then 4
                  when lower(coalesce(r.description, '')) like $3 escape '\\' then 5
                  when cause.normalized_name like $3 escape '\\'
                    or effect.normalized_name like $3 escape '\\'
                    or exists (
                      select 1 from event_aliases a
                      where a.event_id in (r.cause_event_id, r.effect_event_id)
                        and a.normalized_alias like $3 escape '\\'
                    ) then 6
                  else 7
                end::int as rank
         from causal_relations r
         join abstract_events cause on cause.id = r.cause_event_id
         join abstract_events effect on effect.id = r.effect_event_id
       )
       select *
       from ranked
       where ranked.rank <= 6
       ${cursorCondition}
       order by ranked.rank, ranked.updated_at desc, ranked.id desc
       limit $${parameters.length}`,
      parameters,
    );
    return result.rows;
  }

  async checkPair(query: RelationPairCheckQuery): Promise<RelationPairCheckResponse> {
    const result = await this.pool.query<RelationRow>(
      `${selectRelation}
       where ((r.cause_event_id = $1 and r.effect_event_id = $2)
          or (r.cause_event_id = $2 and r.effect_event_id = $1))
         and ($3::uuid is null or r.id <> $3)
       order by r.id`,
      [query.causeEventId, query.effectEventId, query.excludeId ?? null],
    );
    const same = result.rows.find(
      (row) =>
        row.cause_event_id === query.causeEventId && row.effect_event_id === query.effectEventId,
    );
    const reverse = result.rows.find(
      (row) =>
        row.cause_event_id === query.effectEventId && row.effect_event_id === query.causeEventId,
    );
    return {
      sameDirection: same ? reference(same) : null,
      reverseDirection: reverse ? reference(reverse) : null,
    };
  }

  async findById(id: string): Promise<RelationDetail | null> {
    const result = await this.pool.query<RelationRow>(`${selectRelation} where r.id = $1`, [id]);
    return result.rows[0] ? detail(result.rows[0]) : null;
  }

  async create(input: RelationFormInput): Promise<RelationDetail> {
    const result = await this.pool.query<{ id: string }>(
      `insert into causal_relations (cause_event_id, effect_event_id, confidence, description)
       values ($1, $2, $3, $4)
       returning id`,
      [input.causeEventId, input.effectEventId, input.confidence, input.description],
    );
    return (await this.findById(result.rows[0]!.id))!;
  }

  async replace(id: string, input: RelationFormInput): Promise<RelationDetail | null> {
    const result = await this.pool.query<{ id: string }>(
      `update causal_relations
       set cause_event_id = $2,
           effect_event_id = $3,
           confidence = $4,
           description = $5,
           updated_at = clock_timestamp()
       where id = $1
       returning id`,
      [id, input.causeEventId, input.effectEventId, input.confidence, input.description],
    );
    if (!result.rows[0]) return null;
    return this.findById(id);
  }
}
