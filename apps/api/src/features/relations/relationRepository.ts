import type {
  RelationDeletionImpact,
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

import {
  resolveDefaultListPage,
  resolvePageWindow,
  type CountRow,
} from '../shared/pagePagination.js';
import { buildSemanticMergeCtes, buildSemanticValues } from '../shared/semanticListMerge.js';
import { escapeLikePattern, normalizeSearchQuery } from '../shared/sqlSearch.js';

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
  preceding_count?: number;
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
  listEnhanced(
    query: RelationListQuery,
    semanticIds: string[],
    semanticIndexUpdating: boolean,
  ): Promise<RelationListResponse>;
  checkPair(query: RelationPairCheckQuery): Promise<RelationPairCheckResponse>;
  findById(id: string): Promise<RelationDetail | null>;
  create(input: RelationFormInput): Promise<RelationDetail>;
  replace(id: string, input: RelationFormInput): Promise<RelationDetail | null>;
  deletionImpact(id: string): Promise<RelationDeletionImpact | null>;
  delete(id: string): Promise<boolean>;
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
    listPage: resolveDefaultListPage(Number(row.preceding_count ?? 0)),
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

const rankedRelationsCte = `with ranked as (
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
       )`;

export class PostgresRelationRepository implements RelationRepository {
  constructor(private readonly pool: Pool) {}

  async list(query: RelationListQuery): Promise<RelationListResponse> {
    const normalizedQuery = normalizeSearchQuery(query.q);
    const totalItems = normalizedQuery
      ? await this.countSearchRows(normalizedQuery, query.orphan, query.eventId)
      : await this.countListRows(query.orphan, query.eventId);
    const { page, totalPages, offset } = resolvePageWindow(totalItems, query.page, query.limit);
    const rows = normalizedQuery
      ? await this.searchRows(normalizedQuery, query.limit, offset, query.orphan, query.eventId)
      : await this.listRows(query.limit, offset, query.orphan, query.eventId);
    return {
      items: rows.map(summary),
      page,
      pageSize: query.limit,
      totalItems,
      totalPages,
      semanticIndexNotice: null,
      semanticIndexUpdating: false,
    };
  }

  async listEnhanced(
    query: RelationListQuery,
    semanticIds: string[],
    semanticIndexUpdating: boolean,
  ): Promise<RelationListResponse> {
    const normalizedQuery = normalizeSearchQuery(query.q);
    const escaped = escapeLikePattern(normalizedQuery);
    const semantic = buildSemanticValues(semanticIds, 4);
    const orphanParameter = 4 + semantic.parameters.length;
    const eventParameter = orphanParameter + 1;
    const parameters: unknown[] = [
      normalizedQuery,
      `${escaped}%`,
      `%${escaped}%`,
      ...semantic.parameters,
      query.orphan,
      query.eventId ?? null,
    ];
    const mergedCte = `${rankedRelationsCte},
       ${buildSemanticMergeCtes(
         `select id, rank as normal_rank
          from ranked
          where rank <= 6`,
         semantic.sql,
       )}, filtered as (
         select ranked.*,
                merged.source_priority,
                merged.normal_rank,
                merged.semantic_rank
         from merged
         join ranked on ranked.id = merged.id
         where ($${orphanParameter}::boolean = false or ranked.case_count = 0)
           and ($${eventParameter}::uuid is null
             or ranked.cause_event_id = $${eventParameter}
             or ranked.effect_event_id = $${eventParameter})
       )`;
    const countResult = await this.pool.query<CountRow>(
      `${mergedCte}
       select count(*)::int as total
       from filtered`,
      parameters,
    );
    const totalItems = countResult.rows[0]!.total;
    const { page, totalPages, offset } = resolvePageWindow(totalItems, query.page, query.limit);
    const rowsResult = await this.pool.query<RelationRow>(
      `${mergedCte}
       select *
       from filtered
       order by source_priority,
                normal_rank nulls last,
                semantic_rank nulls last,
                updated_at desc,
                id desc
       limit $${eventParameter + 1}
       offset $${eventParameter + 2}`,
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

  private async countListRows(orphan: boolean, eventId?: string): Promise<number> {
    const result = await this.pool.query<CountRow>(
      `select count(*)::int as total
       from causal_relations r
       where ($1::boolean = false or not exists (
         select 1
         from causal_relation_cases crc
         where crc.causal_relation_id = r.id
       ))
         and ($2::uuid is null or r.cause_event_id = $2 or r.effect_event_id = $2)`,
      [orphan, eventId ?? null],
    );
    return result.rows[0]!.total;
  }

  private async listRows(
    limit: number,
    offset: number,
    orphan: boolean,
    eventId?: string,
  ): Promise<RelationRow[]> {
    const result = await this.pool.query<RelationRow>(
      `${selectRelation}
       where ($1::boolean = false or not exists (
         select 1
         from causal_relation_cases filter_case
         where filter_case.causal_relation_id = r.id
       ))
         and ($2::uuid is null or r.cause_event_id = $2 or r.effect_event_id = $2)
       order by r.updated_at desc, r.id desc
       limit $3 offset $4`,
      [orphan, eventId ?? null, limit, offset],
    );
    return result.rows;
  }

  private async countSearchRows(query: string, orphan: boolean, eventId?: string): Promise<number> {
    const escaped = escapeLikePattern(query);
    const result = await this.pool.query<CountRow>(
      `${rankedRelationsCte}
       select count(*)::int as total
       from ranked
       where ranked.rank <= 6
         and ($4::boolean = false or ranked.case_count = 0)
         and ($5::uuid is null
           or ranked.cause_event_id = $5
           or ranked.effect_event_id = $5)`,
      [query, `${escaped}%`, `%${escaped}%`, orphan, eventId ?? null],
    );
    return result.rows[0]!.total;
  }

  private async searchRows(
    query: string,
    limit: number,
    offset: number,
    orphan: boolean,
    eventId?: string,
  ): Promise<RelationRow[]> {
    const escaped = escapeLikePattern(query);
    const parameters: unknown[] = [
      query,
      `${escaped}%`,
      `%${escaped}%`,
      orphan,
      eventId ?? null,
      limit,
      offset,
    ];

    const result = await this.pool.query<RelationRow>(
      `${rankedRelationsCte}
       select *
       from ranked
       where ranked.rank <= 6
         and ($4::boolean = false or ranked.case_count = 0)
         and ($5::uuid is null
           or ranked.cause_event_id = $5
           or ranked.effect_event_id = $5)
       order by ranked.rank, ranked.updated_at desc, ranked.id desc
       limit $6 offset $7`,
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
    const result = await this.pool.query<RelationRow>(
      `select selected.*,
              (select count(*)::int
               from causal_relations preceding
               where (preceding.updated_at, preceding.id) > (selected.updated_at, selected.id)
              ) as preceding_count
       from (${selectRelation} where r.id = $1) selected`,
      [id],
    );
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

  async deletionImpact(id: string): Promise<RelationDeletionImpact | null> {
    const result = await this.pool.query<{ id: string; has_cases: boolean }>(
      `select r.id,
              exists (
                select 1
                from causal_relation_cases crc
                where crc.causal_relation_id = r.id
              ) as has_cases
       from causal_relations r
       where r.id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row
      ? {
          canDelete: true,
          hasEvents: true,
          hasCases: row.has_cases,
        }
      : null;
  }

  async delete(id: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const target = await client.query<{ id: string }>(
        `select id from causal_relations where id = $1 for update`,
        [id],
      );
      if (!target.rows[0]) {
        await client.query('rollback');
        return false;
      }
      await client.query(`delete from causal_relation_cases where causal_relation_id = $1`, [id]);
      await client.query(`delete from causal_relations where id = $1`, [id]);
      await client.query('commit');
      return true;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
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
