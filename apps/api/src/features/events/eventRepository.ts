import type {
  EventCandidateListResponse,
  EventCandidateQuery,
  EventDetail,
  EventFormInput,
  EventListQuery,
  EventListResponse,
  EventSummary,
} from '@causality/contracts';
import type { Pool, PoolClient } from 'pg';

import {
  decodeEventCandidateCursor,
  encodeEventCandidateCursor,
  type EventCandidateCursorState,
} from './eventCursor.js';
import { resolvePageWindow, type CountRow } from '../shared/pagePagination.js';
import { escapeLikePattern, normalizeSearchQuery } from '../shared/sqlSearch.js';

interface EventRow {
  id: string;
  name: string;
  description: string | null;
  created_at: Date;
  updated_at: Date;
  normalized_name?: string;
  rank?: number;
}

interface AliasRow {
  event_id: string;
  alias: string;
}

interface KeywordRow {
  event_id: string;
  keyword: string;
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

export interface EventRepository {
  list(query: EventListQuery): Promise<EventListResponse>;
  findCandidates(query: EventCandidateQuery): Promise<EventCandidateListResponse>;
  findById(id: string): Promise<EventDetail | null>;
  create(input: EventFormInput): Promise<EventDetail>;
  replace(id: string, input: EventFormInput): Promise<EventDetail | null>;
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
    updatedAt: row.updated_at.toISOString(),
  };
}

function createDetail(row: EventRow, aliases: string[], keywords: string[]): EventDetail {
  return {
    ...createSummary(row, aliases, keywords),
    description: row.description,
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
      ? await this.countSearchRows(normalizedQuery)
      : await this.countListRows();
    const { page, totalPages, offset } = resolvePageWindow(totalItems, query.page, query.limit);
    const rows = normalizedQuery
      ? await this.searchRows(normalizedQuery, query.limit, undefined, offset)
      : await this.listRows(query.limit, offset);
    const eventIds = rows.map((row) => row.id);
    const [aliasMap, keywordMap] = await Promise.all([
      this.loadAliases(eventIds),
      this.loadKeywords(eventIds),
    ]);
    const items = rows.map((row) =>
      createSummary(row, aliasMap.get(row.id) ?? [], keywordMap.get(row.id) ?? []),
    );

    return { items, page, pageSize: query.limit, totalItems, totalPages };
  }

  private async countListRows(): Promise<number> {
    const result = await this.pool.query<CountRow>(
      `select count(*)::int as total from abstract_events`,
    );
    return result.rows[0]!.total;
  }

  private async listRows(limit: number, offset: number): Promise<EventRow[]> {
    const result = await this.pool.query<EventRow>(
      `select id, name, description, created_at, updated_at
       from abstract_events
       order by updated_at desc, id desc
       limit $1 offset $2`,
      [limit, offset],
    );
    return result.rows;
  }

  private async countSearchRows(query: string): Promise<number> {
    const escaped = escapeLikePattern(query);
    const result = await this.pool.query<CountRow>(
      `${eventSearchCte}
       select count(*)::int as total from ranked`,
      [query, `${escaped}%`, `%${escaped}%`],
    );
    return result.rows[0]!.total;
  }

  private async searchRows(
    query: string,
    limit: number,
    cursor?: EventCandidateCursorState,
    offset = 0,
  ): Promise<EventRow[]> {
    const searchCursor = cursor;
    const escaped = escapeLikePattern(query);
    const parameters: unknown[] = [query, `${escaped}%`, `%${escaped}%`];
    const cursorCondition = searchCursor
      ? `where (r.rank, e.normalized_name, e.id) > ($4::int, $5::text, $6::uuid)`
      : '';
    if (searchCursor) {
      parameters.push(searchCursor.rank, searchCursor.normalizedName, searchCursor.id);
    }
    parameters.push(limit, offset);

    const result = await this.pool.query<EventRow>(
      `${eventSearchCte}
       select e.id, e.name, e.description, e.created_at, e.updated_at,
              e.normalized_name, r.rank
       from ranked r
       join abstract_events e on e.id = r.id
       ${cursorCondition}
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
      `select id, name, description, created_at, updated_at
       from abstract_events
       where id = $1`,
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
      await client.query('commit');
      return createDetail(row, input.aliases, input.keywords);
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
