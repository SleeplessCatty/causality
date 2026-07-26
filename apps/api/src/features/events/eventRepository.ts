import type {
  EventCandidateListResponse,
  EventCandidateQuery,
  EventDeletionImpact,
  EventDetail,
  EventFormInput,
  EventListQuery,
  EventListResponse,
  EventRelationListQuery,
  EventRelationListResponse,
  EventRelationSummary,
  EventSummary,
} from '@causality/contracts';
import type { Pool, PoolClient } from 'pg';

import {
  decodeEventCandidateCursor,
  decodeEventRelationCursor,
  encodeEventCandidateCursor,
  encodeEventRelationCursor,
  type EventCandidateCursorState,
} from './eventCursor.js';
import {
  resolveDefaultListPage,
  resolvePageWindow,
  type CountRow,
} from '../shared/pagePagination.js';
import { buildSemanticMergeCtes, buildSemanticValues } from '../shared/semanticListMerge.js';
import { escapeLikePattern, normalizeSearchQuery } from '../shared/sqlSearch.js';

interface EventRow {
  id: string;
  name: string;
  description: string | null;
  created_at: Date;
  updated_at: Date;
  normalized_name?: string;
  rank?: number;
  relation_count?: number;
  preceding_count?: number;
}

interface AliasRow {
  event_id: string;
  alias: string;
}

interface KeywordRow {
  event_id: string;
  keyword: string;
}

interface EventRelationRow {
  id: string;
  cause_event_id: string;
  cause_event_name: string;
  effect_event_id: string;
  effect_event_name: string;
  linked_at: Date;
  cursor_at: string;
}

const eventSearchCte = `with matches as (
         select e.id,
                case when e.normalized_name = $1 then 1
                     when e.normalized_name like $2 escape '\\' then 2
                     else 6 end as rank
         from abstract_events e
         where e.normalized_name like $3 escape '\\'
         union all
         select a.event_id,
                case when a.normalized_alias = $1 then 3
                     when a.normalized_alias like $2 escape '\\' then 4
                     else 6 end as rank
         from event_aliases a
         where a.normalized_alias like $3 escape '\\'
         union all
         select k.event_id,
                case when k.normalized_keyword = $1 then 5 else 6 end as rank
         from event_keywords k
         where k.normalized_keyword like $3 escape '\\'
       ), ranked as (
         select id, min(rank)::int as rank
         from matches
         group by id
       )`;

const eventRelationCountSql = `(select count(*)::int
  from causal_relations relation_count_source
  where relation_count_source.cause_event_id = e.id
     or relation_count_source.effect_event_id = e.id)`;

export interface EventRepository {
  list(query: EventListQuery): Promise<EventListResponse>;
  listEnhanced(
    query: EventListQuery,
    semanticIds: string[],
    semanticIndexUpdating: boolean,
  ): Promise<EventListResponse>;
  findCandidates(query: EventCandidateQuery): Promise<EventCandidateListResponse>;
  findById(id: string): Promise<EventDetail | null>;
  existsById(id: string): Promise<boolean>;
  listRelations(id: string, query: EventRelationListQuery): Promise<EventRelationListResponse>;
  create(input: EventFormInput): Promise<EventDetail>;
  replace(id: string, input: EventFormInput): Promise<EventDetail | null>;
  deletionImpact(id: string): Promise<EventDeletionImpact | null>;
  delete(id: string): Promise<boolean>;
}

function sortAliases(values: string[]): string[] {
  return values.toSorted((left, right) => left.localeCompare(right, 'zh-CN'));
}

function createSummary(row: EventRow, aliases: string[], keywords: string[]): EventSummary {
  return {
    id: row.id,
    name: row.name,
    aliases: sortAliases(aliases),
    keywords,
    relationCount: Number(row.relation_count ?? 0),
    updatedAt: row.updated_at.toISOString(),
  };
}

function createDetail(
  row: EventRow,
  aliases: string[],
  keywords: string[],
  relationCount = Number(row.relation_count ?? 0),
): EventDetail {
  return {
    ...createSummary(row, aliases, keywords),
    description: row.description,
    relationCount,
    listPage: resolveDefaultListPage(Number(row.preceding_count ?? 0)),
    createdAt: row.created_at.toISOString(),
  };
}

export class PostgresEventRepository implements EventRepository {
  constructor(private readonly pool: Pool) {}

  private async loadAliases(eventIds: string[]): Promise<Map<string, string[]>> {
    if (eventIds.length === 0) return new Map();

    const result = await this.pool.query<AliasRow>(
      `select event_id, alias
       from event_aliases
       where event_id = any($1::uuid[])
       order by event_id, normalized_alias, id`,
      [eventIds],
    );
    const aliases = new Map<string, string[]>();
    for (const row of result.rows) {
      const values = aliases.get(row.event_id) ?? [];
      values.push(row.alias);
      aliases.set(row.event_id, values);
    }
    return aliases;
  }

  private async loadKeywords(eventIds: string[]): Promise<Map<string, string[]>> {
    if (eventIds.length === 0) return new Map();

    const result = await this.pool.query<KeywordRow>(
      `select event_id, keyword
       from event_keywords
       where event_id = any($1::uuid[])
       order by event_id, position`,
      [eventIds],
    );
    const keywords = new Map<string, string[]>();
    for (const row of result.rows) {
      const values = keywords.get(row.event_id) ?? [];
      values.push(row.keyword);
      keywords.set(row.event_id, values);
    }
    return keywords;
  }

  async list(query: EventListQuery): Promise<EventListResponse> {
    const normalizedQuery = normalizeSearchQuery(query.q);
    const totalItems = normalizedQuery
      ? await this.countSearchRows(normalizedQuery, query.orphan)
      : await this.countListRows(query.orphan);
    const { page, totalPages, offset } = resolvePageWindow(totalItems, query.page, query.limit);
    const rows = normalizedQuery
      ? await this.searchRows(normalizedQuery, query.limit, undefined, offset, query.orphan, true)
      : await this.listRows(query.limit, offset, query.orphan);
    const eventIds = rows.map((row) => row.id);
    const [aliasMap, keywordMap] = await Promise.all([
      this.loadAliases(eventIds),
      this.loadKeywords(eventIds),
    ]);
    const items = rows.map((row) =>
      createSummary(row, aliasMap.get(row.id) ?? [], keywordMap.get(row.id) ?? []),
    );

    return {
      items,
      page,
      pageSize: query.limit,
      totalItems,
      totalPages,
      semanticIndexNotice: null,
      semanticIndexUpdating: false,
    };
  }

  async listEnhanced(
    query: EventListQuery,
    semanticIds: string[],
    semanticIndexUpdating: boolean,
  ): Promise<EventListResponse> {
    const normalizedQuery = normalizeSearchQuery(query.q);
    const escaped = escapeLikePattern(normalizedQuery);
    const semantic = buildSemanticValues(semanticIds, 4);
    const orphanParameter = 4 + semantic.parameters.length;
    const parameters: unknown[] = [
      normalizedQuery,
      `${escaped}%`,
      `%${escaped}%`,
      ...semantic.parameters,
      query.orphan,
    ];
    const mergedCte = `${eventSearchCte},
       ${buildSemanticMergeCtes(
         `select id, rank as normal_rank
          from ranked`,
         semantic.sql,
       )}, filtered as (
         select e.id,
                e.name,
                e.description,
                e.created_at,
                e.updated_at,
                e.normalized_name,
                merged.source_priority,
                merged.normal_rank,
                merged.semantic_rank,
                ${eventRelationCountSql} as relation_count
         from merged
         join abstract_events e on e.id = merged.id
         where ($${orphanParameter}::boolean = false or not exists (
           select 1
           from causal_relations filter_relation
           where filter_relation.cause_event_id = e.id
              or filter_relation.effect_event_id = e.id
         ))
       )`;
    const countResult = await this.pool.query<CountRow>(
      `${mergedCte}
       select count(*)::int as total
       from filtered`,
      parameters,
    );
    const totalItems = countResult.rows[0]!.total;
    const { page, totalPages, offset } = resolvePageWindow(totalItems, query.page, query.limit);
    const rowsResult = await this.pool.query<EventRow>(
      `${mergedCte}
       select *
       from filtered
       order by source_priority,
                normal_rank nulls last,
                semantic_rank nulls last,
                normalized_name,
                id
       limit $${orphanParameter + 1}
       offset $${orphanParameter + 2}`,
      [...parameters, query.limit, offset],
    );
    const eventIds = rowsResult.rows.map((row) => row.id);
    const [aliasMap, keywordMap] = await Promise.all([
      this.loadAliases(eventIds),
      this.loadKeywords(eventIds),
    ]);
    return {
      items: rowsResult.rows.map((row) =>
        createSummary(row, aliasMap.get(row.id) ?? [], keywordMap.get(row.id) ?? []),
      ),
      page,
      pageSize: query.limit,
      totalItems,
      totalPages,
      semanticIndexNotice: null,
      semanticIndexUpdating,
    };
  }

  private async countListRows(orphan: boolean): Promise<number> {
    const result = await this.pool.query<CountRow>(
      `select count(*)::int as total
       from abstract_events e
       where ($1::boolean = false or not exists (
         select 1
         from causal_relations r
         where r.cause_event_id = e.id or r.effect_event_id = e.id
       ))`,
      [orphan],
    );
    return result.rows[0]!.total;
  }

  private async listRows(limit: number, offset: number, orphan: boolean): Promise<EventRow[]> {
    const result = await this.pool.query<EventRow>(
      `select e.id, e.name, e.description, e.created_at, e.updated_at,
              ${eventRelationCountSql} as relation_count
       from abstract_events e
       where ($1::boolean = false or not exists (
         select 1
         from causal_relations r
         where r.cause_event_id = e.id or r.effect_event_id = e.id
       ))
       order by updated_at desc, id desc
       limit $2 offset $3`,
      [orphan, limit, offset],
    );
    return result.rows;
  }

  private async countSearchRows(query: string, orphan: boolean): Promise<number> {
    const escaped = escapeLikePattern(query);
    const result = await this.pool.query<CountRow>(
      `${eventSearchCte}
       select count(*)::int as total
       from ranked
       join abstract_events e on e.id = ranked.id
       where ($4::boolean = false or not exists (
         select 1
         from causal_relations r
         where r.cause_event_id = e.id or r.effect_event_id = e.id
       ))`,
      [query, `${escaped}%`, `%${escaped}%`, orphan],
    );
    return result.rows[0]!.total;
  }

  private async searchRows(
    query: string,
    limit: number,
    cursor?: EventCandidateCursorState,
    offset = 0,
    orphan = false,
    includeRelationCount = false,
  ): Promise<EventRow[]> {
    const searchCursor = cursor;
    const escaped = escapeLikePattern(query);
    const parameters: unknown[] = [query, `${escaped}%`, `%${escaped}%`];
    const conditions: string[] = [];
    if (searchCursor) {
      conditions.push(`(r.rank, e.normalized_name, e.id) > ($4::int, $5::text, $6::uuid)`);
      parameters.push(searchCursor.rank, searchCursor.normalizedName, searchCursor.id);
    }
    parameters.push(orphan);
    conditions.push(`($${parameters.length}::boolean = false or not exists (
      select 1
      from causal_relations filter_relation
      where filter_relation.cause_event_id = e.id
         or filter_relation.effect_event_id = e.id
    ))`);
    parameters.push(limit, offset);
    const relationCountSelection = includeRelationCount
      ? `, ${eventRelationCountSql} as relation_count`
      : '';

    const result = await this.pool.query<EventRow>(
      `${eventSearchCte}
       select e.id, e.name, e.description, e.created_at, e.updated_at,
              e.normalized_name, r.rank${relationCountSelection}
       from ranked r
       join abstract_events e on e.id = r.id
       where ${conditions.join(' and ')}
       order by r.rank, e.normalized_name, e.id
       limit $${parameters.length - 1} offset $${parameters.length}`,
      parameters,
    );
    return result.rows;
  }

  async findCandidates(query: EventCandidateQuery): Promise<EventCandidateListResponse> {
    const normalizedQuery = normalizeSearchQuery(query.q);
    const cursor = query.cursor
      ? decodeEventCandidateCursor(query.cursor, normalizedQuery, query.excludeId)
      : undefined;
    const rows = await this.searchRows(normalizedQuery, query.limit + 2, cursor);
    const eligible = rows.filter((row) => row.id !== query.excludeId).slice(0, query.limit + 1);
    const hasMore = eligible.length > query.limit;
    const pageRows = eligible.slice(0, query.limit);
    const last = pageRows.at(-1);

    return {
      items: pageRows.map((row) => ({ id: row.id, name: row.name })),
      hasMore,
      nextCursor:
        hasMore && last
          ? encodeEventCandidateCursor({
              query: normalizedQuery,
              excludeId: query.excludeId ?? null,
              rank: last.rank!,
              normalizedName: last.normalized_name!,
              id: last.id,
            })
          : null,
    };
  }

  async findById(id: string): Promise<EventDetail | null> {
    const result = await this.pool.query<EventRow>(
      `select e.id, e.name, e.description, e.created_at, e.updated_at,
              ${eventRelationCountSql} as relation_count,
              (select count(*)::int
               from abstract_events preceding
               where (preceding.updated_at, preceding.id) > (e.updated_at, e.id)
              ) as preceding_count
       from abstract_events e
       where e.id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) return null;
    const [aliases, keywords] = await Promise.all([
      this.loadAliases([id]),
      this.loadKeywords([id]),
    ]);
    return createDetail(row, aliases.get(id) ?? [], keywords.get(id) ?? []);
  }

  async existsById(id: string): Promise<boolean> {
    const result = await this.pool.query<{ exists: boolean }>(
      `select exists(select 1 from abstract_events where id = $1)`,
      [id],
    );
    return result.rows[0]!.exists;
  }

  async deletionImpact(id: string): Promise<EventDeletionImpact | null> {
    const result = await this.pool.query<{ id: string; has_relations: boolean }>(
      `select e.id,
              exists (
                select 1
                from causal_relations r
                where r.cause_event_id = e.id or r.effect_event_id = e.id
              ) as has_relations
       from abstract_events e
       where e.id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row
      ? {
          canDelete: !row.has_relations,
          hasRelations: row.has_relations,
        }
      : null;
  }

  async delete(id: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const target = await client.query<{ id: string }>(
        `select id from abstract_events where id = $1 for update`,
        [id],
      );
      if (!target.rows[0]) {
        await client.query('rollback');
        return false;
      }
      const impact = await client.query<{ has_relations: boolean }>(
        `select exists (
           select 1
           from causal_relations
           where cause_event_id = $1 or effect_event_id = $1
         ) as has_relations`,
        [id],
      );
      if (impact.rows[0]!.has_relations) {
        throw Object.assign(new Error('Event is referenced by a relation'), {
          code: 'EVENT_DELETE_BLOCKED',
        });
      }
      await client.query(`delete from abstract_events where id = $1`, [id]);
      await client.query('commit');
      return true;
    } catch (error) {
      await client.query('rollback');
      if ((error as { code?: string }).code === '23503') {
        throw Object.assign(new Error('Event is referenced by a relation'), {
          code: 'EVENT_DELETE_BLOCKED',
        });
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async listRelations(
    id: string,
    query: EventRelationListQuery,
  ): Promise<EventRelationListResponse> {
    const cursor = query.cursor ? decodeEventRelationCursor(query.cursor, id) : undefined;
    const parameters: unknown[] = [id];
    const cursorCondition = cursor ? `and (r.created_at, r.id) < ($2::timestamptz, $3::uuid)` : '';
    if (cursor) parameters.push(cursor.linkedAt, cursor.relationId);
    parameters.push(query.limit + 1);
    const branchLimit = `$${parameters.length}`;
    const result = await this.pool.query<EventRelationRow>(
      `with selected as (
         (select r.id, r.cause_event_id, r.effect_event_id, r.created_at
          from causal_relations r
          where r.cause_event_id = $1
          ${cursorCondition}
          order by r.created_at desc, r.id desc
          limit ${branchLimit})
         union all
         (select r.id, r.cause_event_id, r.effect_event_id, r.created_at
          from causal_relations r
          where r.effect_event_id = $1
          ${cursorCondition}
          order by r.created_at desc, r.id desc
          limit ${branchLimit})
       )
       select selected.id,
              selected.cause_event_id,
              cause.name as cause_event_name,
              selected.effect_event_id,
              effect.name as effect_event_name,
              selected.created_at as linked_at,
              to_char(
                selected.created_at at time zone 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
              ) as cursor_at
       from selected
       join abstract_events cause on cause.id = selected.cause_event_id
       join abstract_events effect on effect.id = selected.effect_event_id
       order by selected.created_at desc, selected.id desc
       limit ${branchLimit}`,
      parameters,
    );
    const hasMore = result.rows.length > query.limit;
    const rows = result.rows.slice(0, query.limit);
    const items: EventRelationSummary[] = rows.map((row) => ({
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
          ? encodeEventRelationCursor({
              eventId: id,
              linkedAt: last.cursor_at,
              relationId: last.id,
            })
          : null,
    };
  }

  async create(input: EventFormInput): Promise<EventDetail> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const inserted = await client.query<EventRow>(
        `insert into abstract_events (name, description)
         values ($1, $2)
         returning id, name, description, created_at, updated_at`,
        [input.name, input.description],
      );
      const row = inserted.rows[0]!;
      await this.insertAliases(client, row.id, input.aliases);
      await this.replaceKeywords(client, row.id, input.keywords);
      const preceding = await client.query<CountRow>(
        `select count(*)::int as total
         from abstract_events
         where (updated_at, id) > ($1, $2)`,
        [row.updated_at, row.id],
      );
      row.preceding_count = preceding.rows[0]!.total;
      await client.query('commit');
      return createDetail(row, input.aliases, input.keywords);
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async replace(id: string, input: EventFormInput): Promise<EventDetail | null> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const updated = await client.query<EventRow>(
        `update abstract_events
         set name = $2,
             description = $3,
             updated_at = clock_timestamp()
         where id = $1
         returning id, name, description, created_at, updated_at`,
        [id, input.name, input.description],
      );
      const row = updated.rows[0];
      if (!row) {
        await client.query('rollback');
        return null;
      }
      await client.query('delete from event_aliases where event_id = $1', [id]);
      await this.insertAliases(client, id, input.aliases);
      await this.replaceKeywords(client, id, input.keywords);
      const relationCount = await client.query<CountRow>(
        `select count(*)::int as total
         from causal_relations
         where cause_event_id = $1 or effect_event_id = $1`,
        [id],
      );
      const preceding = await client.query<CountRow>(
        `select count(*)::int as total
         from abstract_events
         where (updated_at, id) > ($1, $2)`,
        [row.updated_at, row.id],
      );
      row.preceding_count = preceding.rows[0]!.total;
      await client.query('commit');
      return createDetail(row, input.aliases, input.keywords, relationCount.rows[0]!.total);
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  private async insertAliases(
    client: PoolClient,
    eventId: string,
    aliases: string[],
  ): Promise<void> {
    if (aliases.length === 0) return;
    await client.query(
      `insert into event_aliases (event_id, alias)
       select $1::uuid, alias
       from unnest($2::text[]) alias`,
      [eventId, aliases],
    );
  }

  private async replaceKeywords(
    client: PoolClient,
    eventId: string,
    keywords: string[],
  ): Promise<void> {
    await client.query('delete from event_keywords where event_id = $1', [eventId]);
    if (keywords.length === 0) return;
    await client.query(
      `insert into event_keywords (event_id, keyword, position)
       select $1::uuid, source.keyword, source.position::integer
       from unnest($2::text[]) with ordinality as source(keyword, position)`,
      [eventId, keywords],
    );
  }
}
