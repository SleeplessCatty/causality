import type {
  CaseDeletionImpact,
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
  RelationCaseListQuery,
  RelationCaseListResponse,
} from '@causality/contracts';
import type { Pool } from 'pg';

import {
  decodeCaseCandidateCursor,
  decodeCaseRelationCursor,
  decodeRelationCaseCursor,
  encodeCaseCandidateCursor,
  encodeCaseRelationCursor,
  encodeRelationCaseCursor,
} from './caseCursor.js';
import {
  resolveDefaultListPage,
  resolvePageWindow,
  type CountRow,
} from '../shared/pagePagination.js';
import { buildSemanticMergeCtes, buildSemanticValues } from '../shared/semanticListMerge.js';
import { escapeLikePattern, normalizeSearchQuery } from '../shared/sqlSearch.js';

interface CaseRow {
  id: string;
  content: string;
  relation_count: number;
  created_at: Date;
  updated_at: Date;
  rank?: number;
  preceding_count?: number;
}

interface CaseCandidateRow extends CaseRow {
  cursor_at: string;
  rank: number;
}

interface CaseRelationRow {
  id: string;
  cause_event_id: string;
  cause_event_name: string;
  effect_event_id: string;
  effect_event_name: string;
  linked_at: Date;
  cursor_at: string;
}

interface RelationCaseRow extends CaseRow {
  linked_at: Date;
  cursor_at: string;
}

export interface CaseRepository {
  list(query: CaseListQuery): Promise<CaseListResponse>;
  listEnhanced(
    query: CaseListQuery,
    semanticIds: string[],
    semanticIndexUpdating: boolean,
  ): Promise<CaseListResponse>;
  listForRelation(
    relationId: string,
    query: RelationCaseListQuery,
  ): Promise<RelationCaseListResponse>;
  candidates(query: CaseCandidateQuery): Promise<CaseCandidateListResponse>;
  findById(id: string): Promise<CaseDetail | null>;
  listRelations(id: string, query: CaseRelationListQuery): Promise<CaseRelationListResponse>;
  create(input: CaseFormInput): Promise<CaseDetail>;
  replace(id: string, input: CaseFormInput): Promise<CaseDetail | null>;
  findByContent(content: string): Promise<CaseReference | null>;
  deletionImpact(id: string): Promise<CaseDeletionImpact | null>;
  delete(id: string): Promise<boolean>;
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
  return {
    ...summary(row),
    listPage: resolveDefaultListPage(Number(row.preceding_count ?? 0)),
    createdAt: row.created_at.toISOString(),
  };
}

const caseSelect = `select c.id,
                           c.content,
                           c.created_at,
                           c.updated_at,
                           (select count(*)::int from causal_relation_cases crc
                            where crc.concrete_case_id = c.id) as relation_count`;

const rankedCasesCte = `${caseSelect},
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
           and ($5::boolean = false or not exists (
             select 1 from causal_relation_cases orphan_link
             where orphan_link.concrete_case_id = c.id
           ))`;

export class PostgresCaseRepository implements CaseRepository {
  constructor(private readonly pool: Pool) {}

  async list(query: CaseListQuery): Promise<CaseListResponse> {
    const normalized = normalizeSearchQuery(query.q);
    const escaped = escapeLikePattern(normalized);
    const filterParameters: unknown[] = [
      normalized,
      `${escaped}%`,
      `%${escaped}%`,
      query.relationId ?? null,
      query.orphan,
    ];
    const countResult = await this.pool.query<CountRow>(
      `with ranked as (
         ${rankedCasesCte}
       )
       select count(*)::int as total from ranked
       where ($1 = '' or ranked.rank is not null)`,
      filterParameters,
    );
    const totalItems = countResult.rows[0]!.total;
    const { page, totalPages, offset } = resolvePageWindow(totalItems, query.page, query.limit);
    const parameters = [...filterParameters, query.limit, offset];
    const result = await this.pool.query<CaseRow>(
      `with ranked as (
         ${rankedCasesCte}
       )
       select * from ranked
       where ($1 = '' or ranked.rank is not null)
       order by ${normalized ? 'ranked.rank,' : ''} ranked.updated_at desc, ranked.id desc
       limit $6 offset $7`,
      parameters,
    );
    return {
      items: result.rows.map(summary),
      page,
      pageSize: query.limit,
      totalItems,
      totalPages,
      semanticIndexNotice: null,
      semanticIndexUpdating: false,
    };
  }

  async listEnhanced(
    query: CaseListQuery,
    semanticIds: string[],
    semanticIndexUpdating: boolean,
  ): Promise<CaseListResponse> {
    const normalized = normalizeSearchQuery(query.q);
    const escaped = escapeLikePattern(normalized);
    const semantic = buildSemanticValues(semanticIds, 4);
    const relationParameter = 4 + semantic.parameters.length;
    const orphanParameter = relationParameter + 1;
    const parameters: unknown[] = [
      normalized,
      `${escaped}%`,
      `%${escaped}%`,
      ...semantic.parameters,
      query.relationId ?? null,
      query.orphan,
    ];
    const mergedCte = `with ranked as (
         ${caseSelect},
                case
                  when lower(c.content) = $1 then 1
                  when lower(c.content) like $2 escape '\\' then 2
                  when lower(c.content) like $3 escape '\\' then 3
                  else null
                end::int as rank
         from concrete_cases c
       ), ${buildSemanticMergeCtes(
         `select id, rank as normal_rank
          from ranked
          where rank is not null`,
         semantic.sql,
       )}, filtered as (
         select ranked.*,
                merged.source_priority,
                merged.normal_rank,
                merged.semantic_rank
         from merged
         join ranked on ranked.id = merged.id
         where ($${relationParameter}::uuid is null or exists (
           select 1
           from causal_relation_cases relation_filter
           where relation_filter.concrete_case_id = ranked.id
             and relation_filter.causal_relation_id = $${relationParameter}
         ))
           and ($${orphanParameter}::boolean = false or ranked.relation_count = 0)
       )`;
    const countResult = await this.pool.query<CountRow>(
      `${mergedCte}
       select count(*)::int as total
       from filtered`,
      parameters,
    );
    const totalItems = countResult.rows[0]!.total;
    const { page, totalPages, offset } = resolvePageWindow(totalItems, query.page, query.limit);
    const rowsResult = await this.pool.query<CaseRow>(
      `${mergedCte}
       select *
       from filtered
       order by source_priority,
                normal_rank nulls last,
                semantic_rank nulls last,
                updated_at desc,
                id desc
       limit $${orphanParameter + 1}
       offset $${orphanParameter + 2}`,
      [...parameters, query.limit, offset],
    );
    return {
      items: rowsResult.rows.map(summary),
      page,
      pageSize: query.limit,
      totalItems,
      totalPages,
      semanticIndexNotice: null,
      semanticIndexUpdating,
    };
  }

  async candidates(query: CaseCandidateQuery): Promise<CaseCandidateListResponse> {
    const normalized = normalizeSearchQuery(query.q);
    const cursor = query.cursor ? decodeCaseCandidateCursor(query.cursor, normalized) : undefined;
    const escaped = escapeLikePattern(normalized);
    const parameters: unknown[] = [normalized, `${escaped}%`, `%${escaped}%`];
    const cursorCondition = cursor
      ? `where ranked.rank > $4::int
           or (ranked.rank = $4::int and
               (ranked.updated_at, ranked.id) < ($5::timestamptz, $6::uuid))`
      : '';
    if (cursor) parameters.push(cursor.rank, cursor.updatedAt, cursor.id);
    parameters.push(query.limit + 1);
    const result = await this.pool.query<CaseCandidateRow>(
      `with ranked as (
         select c.id,
                c.content,
                c.created_at,
                c.updated_at,
                to_char(
                  c.updated_at at time zone 'UTC',
                  'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
                ) as cursor_at,
                0::int as relation_count,
                case
                  when lower(c.content) = $1 then 1
                  when lower(c.content) like $2 escape '\\' then 2
                  else 3
                end::int as rank
         from concrete_cases c
         where lower(c.content) like $3 escape '\\'
       )
       select * from ranked
       ${cursorCondition}
       order by ranked.rank, ranked.updated_at desc, ranked.id desc
       limit $${parameters.length}`,
      parameters,
    );
    const hasMore = result.rows.length > query.limit;
    const rows = result.rows.slice(0, query.limit);
    const last = rows.at(-1);
    return {
      items: rows.map(reference),
      hasMore,
      nextCursor:
        hasMore && last
          ? encodeCaseCandidateCursor({
              query: normalized,
              rank: last.rank,
              updatedAt: last.cursor_at,
              id: last.id,
            })
          : null,
    };
  }

  async listForRelation(
    relationId: string,
    query: RelationCaseListQuery,
  ): Promise<RelationCaseListResponse> {
    const cursor = query.cursor ? decodeRelationCaseCursor(query.cursor, relationId) : undefined;
    const parameters: unknown[] = [relationId];
    const cursorCondition = cursor ? `and (crc.linked_at, c.id) < ($2::timestamptz, $3::uuid)` : '';
    if (cursor) parameters.push(cursor.linkedAt, cursor.caseId);
    parameters.push(query.limit + 1);
    const result = await this.pool.query<RelationCaseRow>(
      `${caseSelect},
              crc.linked_at,
              to_char(
                crc.linked_at at time zone 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
              ) as cursor_at
       from causal_relation_cases crc
       join concrete_cases c on c.id = crc.concrete_case_id
       where crc.causal_relation_id = $1
       ${cursorCondition}
       order by crc.linked_at desc, c.id desc
       limit $${parameters.length}`,
      parameters,
    );
    const hasMore = result.rows.length > query.limit;
    const rows = result.rows.slice(0, query.limit);
    const last = rows.at(-1);
    return {
      items: rows.map((row) => ({ ...summary(row), linkedAt: row.linked_at.toISOString() })),
      hasMore,
      nextCursor:
        hasMore && last
          ? encodeRelationCaseCursor({
              relationId,
              linkedAt: last.cursor_at,
              caseId: last.id,
            })
          : null,
    };
  }

  async findById(id: string): Promise<CaseDetail | null> {
    const result = await this.pool.query<CaseRow>(
      `${caseSelect},
              (select count(*)::int
               from concrete_cases preceding
               where (preceding.updated_at, preceding.id) > (c.updated_at, c.id)
              ) as preceding_count
       from concrete_cases c
       where c.id = $1`,
      [id],
    );
    return result.rows[0] ? detail(result.rows[0]) : null;
  }

  async deletionImpact(id: string): Promise<CaseDeletionImpact | null> {
    const result = await this.pool.query<{ id: string; has_relations: boolean }>(
      `select c.id,
              exists (
                select 1
                from causal_relation_cases crc
                where crc.concrete_case_id = c.id
              ) as has_relations
       from concrete_cases c
       where c.id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row
      ? {
          canDelete: true,
          hasRelations: row.has_relations,
        }
      : null;
  }

  async delete(id: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const target = await client.query<{ id: string }>(
        `select id from concrete_cases where id = $1 for update`,
        [id],
      );
      if (!target.rows[0]) {
        await client.query('rollback');
        return false;
      }
      await client.query(`delete from causal_relation_cases where concrete_case_id = $1`, [id]);
      await client.query(`delete from concrete_cases where id = $1`, [id]);
      await client.query('commit');
      return true;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
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
              crc.linked_at,
              to_char(
                crc.linked_at at time zone 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
              ) as cursor_at
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
              linkedAt: last.cursor_at,
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
