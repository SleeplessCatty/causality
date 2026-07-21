import type {
  CaseCandidateListResponse,
  CaseCandidateQuery,
  CaseDetail,
  CaseFormInput,
  CaseListQuery,
  CaseListResponse,
  CaseReference,
  CaseRelationListQuery,
  CaseRelationListResponse,
  CaseRelationSummary,
  CaseSummary,
} from '@causality/contracts';
import type { Pool } from 'pg';

import {
  decodeCaseListCursor,
  decodeCaseRelationCursor,
  encodeCaseListCursor,
  encodeCaseRelationCursor,
} from './caseCursor.js';

interface CaseRow {
  id: string;
  content: string;
  relation_count: number;
  created_at: Date;
  updated_at: Date;
  rank?: number;
}

interface CaseRelationRow {
  id: string;
  cause_event_id: string;
  cause_event_name: string;
  effect_event_id: string;
  effect_event_name: string;
  linked_at: Date;
}

export interface CaseRepository {
  list(query: CaseListQuery): Promise<CaseListResponse>;
  candidates(query: CaseCandidateQuery): Promise<CaseCandidateListResponse>;
  findById(id: string): Promise<CaseDetail | null>;
  listRelations(id: string, query: CaseRelationListQuery): Promise<CaseRelationListResponse>;
  create(input: CaseFormInput): Promise<CaseDetail>;
  replace(id: string, input: CaseFormInput): Promise<CaseDetail | null>;
  findByContent(content: string): Promise<CaseReference | null>;
}

function normalizeQuery(query: string): string {
  return query.trim().toLocaleLowerCase();
}

function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

function reference(row: Pick<CaseRow, 'id' | 'content'>): CaseReference {
  return { id: row.id, content: row.content };
}

function summary(row: CaseRow): CaseSummary {
  return {
    ...reference(row),
    relationCount: Number(row.relation_count),
    updatedAt: row.updated_at.toISOString(),
  };
}

function detail(row: CaseRow): CaseDetail {
  return { ...summary(row), createdAt: row.created_at.toISOString() };
}

const caseSelect = `select c.id,
                           c.content,
                           c.created_at,
                           c.updated_at,
                           (select count(*)::int from causal_relation_cases crc
                            where crc.concrete_case_id = c.id) as relation_count`;

export class PostgresCaseRepository implements CaseRepository {
  constructor(private readonly pool: Pool) {}

  async list(query: CaseListQuery): Promise<CaseListResponse> {
    const normalized = normalizeQuery(query.q);
    const cursor = query.cursor
      ? decodeCaseListCursor(query.cursor, normalized, query.relationId)
      : undefined;
    const escaped = escapeLike(normalized);
    const parameters: unknown[] = [
      normalized,
      `${escaped}%`,
      `%${escaped}%`,
      query.relationId ?? null,
    ];
    const cursorCondition = cursor
      ? normalized
        ? `and (ranked.rank > $5::int or
                 (ranked.rank = $5::int and
                  (ranked.updated_at, ranked.id) < ($6::timestamptz, $7::uuid)))`
        : `and (ranked.updated_at, ranked.id) < ($5::timestamptz, $6::uuid)`
      : '';
    if (cursor) {
      if (normalized) parameters.push(cursor.rank, cursor.updatedAt, cursor.id);
      else parameters.push(cursor.updatedAt, cursor.id);
    }
    parameters.push(query.limit + 1);
    const result = await this.pool.query<CaseRow>(
      `with ranked as (
         ${caseSelect},
                case
                  when lower(c.content) = $1 then 1
                  when lower(c.content) like $2 escape '\\' then 2
                  when lower(c.content) like $3 escape '\\' then 3
                  else null
                end::int as rank
         from concrete_cases c
         where ($1 = '' or lower(c.content) like $3 escape '\\')
           and ($4::uuid is null or exists (
             select 1 from causal_relation_cases f
             where f.concrete_case_id = c.id and f.causal_relation_id = $4
           ))
       )
       select * from ranked
       where ($1 = '' or ranked.rank is not null)
       ${cursorCondition}
       order by ${normalized ? 'ranked.rank,' : ''} ranked.updated_at desc, ranked.id desc
       limit $${parameters.length}`,
      parameters,
    );
    const hasMore = result.rows.length > query.limit;
    const rows = result.rows.slice(0, query.limit);
    const last = rows.at(-1);
    return {
      items: rows.map(summary),
      hasMore,
      nextCursor:
        hasMore && last
          ? encodeCaseListCursor({
              query: normalized,
              filterRelationId: query.relationId ?? null,
              rank: normalized ? last.rank! : null,
              updatedAt: last.updated_at.toISOString(),
              id: last.id,
            })
          : null,
    };
  }

  async candidates(query: CaseCandidateQuery): Promise<CaseCandidateListResponse> {
    const normalized = normalizeQuery(query.q);
    const escaped = escapeLike(normalized);
    const result = await this.pool.query<CaseRow>(
      `select c.id, c.content, c.created_at, c.updated_at, 0::int as relation_count
       from concrete_cases c
       where lower(c.content) like $3 escape '\\'
       order by case
                  when lower(c.content) = $1 then 1
                  when lower(c.content) like $2 escape '\\' then 2
                  else 3
                end,
                c.updated_at desc,
                c.id desc
       limit $4`,
      [normalized, `${escaped}%`, `%${escaped}%`, query.limit],
    );
    return { items: result.rows.map(reference) };
  }

  async findById(id: string): Promise<CaseDetail | null> {
    const result = await this.pool.query<CaseRow>(
      `${caseSelect} from concrete_cases c where c.id = $1`,
      [id],
    );
    return result.rows[0] ? detail(result.rows[0]) : null;
  }

  async listRelations(id: string, query: CaseRelationListQuery): Promise<CaseRelationListResponse> {
    const cursor = query.cursor ? decodeCaseRelationCursor(query.cursor, id) : undefined;
    const parameters: unknown[] = [id];
    const condition = cursor ? `and (crc.linked_at, r.id) < ($2::timestamptz, $3::uuid)` : '';
    if (cursor) parameters.push(cursor.linkedAt, cursor.relationId);
    parameters.push(query.limit + 1);
    const result = await this.pool.query<CaseRelationRow>(
      `select r.id,
              r.cause_event_id,
              cause.name as cause_event_name,
              r.effect_event_id,
              effect.name as effect_event_name,
              crc.linked_at
       from causal_relation_cases crc
       join causal_relations r on r.id = crc.causal_relation_id
       join abstract_events cause on cause.id = r.cause_event_id
       join abstract_events effect on effect.id = r.effect_event_id
       where crc.concrete_case_id = $1
       ${condition}
       order by crc.linked_at desc, r.id desc
       limit $${parameters.length}`,
      parameters,
    );
    const hasMore = result.rows.length > query.limit;
    const rows = result.rows.slice(0, query.limit);
    const items: CaseRelationSummary[] = rows.map((row) => ({
      id: row.id,
      causeEvent: { id: row.cause_event_id, name: row.cause_event_name },
      effectEvent: { id: row.effect_event_id, name: row.effect_event_name },
      linkedAt: row.linked_at.toISOString(),
    }));
    const last = rows.at(-1);
    return {
      items,
      hasMore,
      nextCursor:
        hasMore && last
          ? encodeCaseRelationCursor({
              caseId: id,
              linkedAt: last.linked_at.toISOString(),
              relationId: last.id,
            })
          : null,
    };
  }

  async create(input: CaseFormInput): Promise<CaseDetail> {
    const result = await this.pool.query<{ id: string }>(
      `insert into concrete_cases (content) values ($1) returning id`,
      [input.content],
    );
    return (await this.findById(result.rows[0]!.id))!;
  }

  async replace(id: string, input: CaseFormInput): Promise<CaseDetail | null> {
    const result = await this.pool.query<{ id: string }>(
      `update concrete_cases
       set content = $2, updated_at = clock_timestamp()
       where id = $1
       returning id`,
      [id, input.content],
    );
    return result.rows[0] ? this.findById(id) : null;
  }

  async findByContent(content: string): Promise<CaseReference | null> {
    const result = await this.pool.query<Pick<CaseRow, 'id' | 'content'>>(
      `select id, content from concrete_cases where content = $1`,
      [content],
    );
    return result.rows[0] ? reference(result.rows[0]) : null;
  }
}
