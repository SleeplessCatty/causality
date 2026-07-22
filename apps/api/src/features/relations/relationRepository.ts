import type {
  RelationDetail,
  RelationFormInput,
  RelationListQuery,
  RelationListResponse,
  RelationPairCheckQuery,
  RelationPairCheckResponse,
  RelationReference,
  RelationSummary,
  CaseReference,
} from '@causality/contracts';
import type { Pool, PoolClient } from 'pg';

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
  case_count: number;
  rank?: number;
}

export class RelationCaseNotFoundError extends Error {
  constructor() {
    super('Selected case not found');
    this.name = 'RelationCaseNotFoundError';
  }
}

export class RelationCaseContentConflictError extends Error {
  constructor(readonly existingId: string) {
    super('Case content already exists');
    this.name = 'RelationCaseContentConflictError';
  }
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
    caseCount: Number(row.case_count),
    updatedAt: row.updated_at.toISOString(),
  };
}

function detail(row: RelationRow, recentCases: CaseReference[]): RelationDetail {
  return {
    ...summary(row),
    description: row.description,
    createdAt: row.created_at.toISOString(),
    recentCases,
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
                               r.updated_at,
                               (select count(*)::int from causal_relation_cases crc
                                where crc.causal_relation_id = r.id) as case_count
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
                (select count(*)::int from causal_relation_cases crc
                 where crc.causal_relation_id = r.id) as case_count,
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
    if (!result.rows[0]) return null;
    const cases = await this.pool.query<{ id: string; content: string }>(
      `select c.id, c.content
       from causal_relation_cases crc
       join concrete_cases c on c.id = crc.concrete_case_id
       where crc.causal_relation_id = $1
       order by crc.linked_at desc, c.id desc
       limit 5`,
      [id],
    );
    return detail(result.rows[0], cases.rows);
  }

  async create(input: RelationFormInput): Promise<RelationDetail> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await client.query<{ id: string }>(
        `insert into causal_relations (cause_event_id, effect_event_id, confidence, description)
         values ($1, $2, $3, $4)
         returning id`,
        [input.causeEventId, input.effectEventId, input.confidence, input.description],
      );
      const id = result.rows[0]!.id;
      await this.replaceCaseSelections(client, id, input.caseSelections);
      await client.query('commit');
      return (await this.findById(id))!;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async replace(id: string, input: RelationFormInput): Promise<RelationDetail | null> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await client.query<{ id: string }>(
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
      if (!result.rows[0]) {
        await client.query('rollback');
        return null;
      }
      await this.replaceCaseSelections(client, id, input.caseSelections);
      await client.query('commit');
      return this.findById(id);
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  private async replaceCaseSelections(
    client: PoolClient,
    relationId: string,
    selections: RelationFormInput['caseSelections'],
  ): Promise<void> {
    const existingIds = selections
      .filter((selection) => selection.type === 'existing')
      .map((selection) => selection.caseId);
    if (existingIds.length > 0) {
      const existing = await client.query<{ id: string }>(
        `select id from concrete_cases where id = any($1::uuid[])`,
        [existingIds],
      );
      if (existing.rows.length !== new Set(existingIds).size) {
        throw new RelationCaseNotFoundError();
      }
    }

    const newContents = selections
      .filter((selection) => selection.type === 'new')
      .map((selection) => selection.content);
    const caseIds = [...existingIds];
    if (newContents.length > 0) {
      const inserted = await client.query<{ id: string; content: string }>(
        `insert into concrete_cases (content)
         select content
         from unnest($1::text[]) as selected(content)
         on conflict (content) do nothing
         returning id, content`,
        [newContents],
      );
      if (inserted.rows.length < newContents.length) {
        const insertedContents = new Set(inserted.rows.map((row) => row.content));
        const matching = await client.query<{ id: string; content: string }>(
          `select id, content from concrete_cases where content = any($1::text[])`,
          [newContents],
        );
        const conflict = matching.rows.find((row) => !insertedContents.has(row.content));
        throw new RelationCaseContentConflictError(conflict!.id);
      }
      caseIds.push(...inserted.rows.map((row) => row.id));
    }

    if (caseIds.length === 0) {
      await client.query(`delete from causal_relation_cases where causal_relation_id = $1`, [
        relationId,
      ]);
    } else {
      await client.query(
        `delete from causal_relation_cases
         where causal_relation_id = $1
           and not (concrete_case_id = any($2::uuid[]))`,
        [relationId, caseIds],
      );
      await client.query(
        `insert into causal_relation_cases (causal_relation_id, concrete_case_id)
         select $1, selected.id
         from unnest($2::uuid[]) selected(id)
         on conflict do nothing`,
        [relationId, caseIds],
      );
    }
  }
}
