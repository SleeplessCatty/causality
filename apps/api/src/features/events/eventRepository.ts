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

import { decodeEventCursor, encodeEventCursor, type EventCursorState } from './eventCursor.js';
import {
  decodeEventCandidateCursor,
  encodeEventCandidateCursor,
  type EventCandidateCursorState,
} from './eventCursor.js';

interface EventRow {
  id: string;
  name: string;
  description: string | null;
  keywords: string[];
  created_at: Date;
  updated_at: Date;
  normalized_name?: string;
  rank?: number;
}

interface AliasRow {
  event_id: string;
  alias: string;
}

export interface EventRepository {
  list(query: EventListQuery): Promise<EventListResponse>;
  findCandidates(query: EventCandidateQuery): Promise<EventCandidateListResponse>;
  findById(id: string): Promise<EventDetail | null>;
  create(input: EventFormInput): Promise<EventDetail>;
  replace(id: string, input: EventFormInput): Promise<EventDetail | null>;
}

function normalizeQuery(query: string): string {
  return query.trim().toLocaleLowerCase();
}

function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

function sortAliases(values: string[]): string[] {
  return values.toSorted((left, right) => left.localeCompare(right, 'zh-CN'));
}

function createSummary(row: EventRow, aliases: string[]): EventSummary {
  return {
    id: row.id,
    name: row.name,
    aliases: sortAliases(aliases),
    keywords: row.keywords,
    updatedAt: row.updated_at.toISOString(),
  };
}

function createDetail(row: EventRow, aliases: string[]): EventDetail {
  return {
    ...createSummary(row, aliases),
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

  async list(query: EventListQuery): Promise<EventListResponse> {
    const normalizedQuery = normalizeQuery(query.q);
    const cursor = query.cursor ? decodeEventCursor(query.cursor, normalizedQuery) : undefined;
    const rows = normalizedQuery
      ? await this.searchRows(normalizedQuery, query.limit + 1, cursor)
      : await this.listRows(query.limit + 1, cursor);
    const hasMore = rows.length > query.limit;
    const pageRows = rows.slice(0, query.limit);
    const aliasMap = await this.loadAliases(pageRows.map((row) => row.id));
    const items = pageRows.map((row) => createSummary(row, aliasMap.get(row.id) ?? []));
    const last = pageRows.at(-1);

    let nextCursor: string | null = null;
    if (hasMore && last) {
      nextCursor = normalizedQuery
        ? encodeEventCursor({
            kind: 'search',
            query: normalizedQuery,
            rank: last.rank!,
            normalizedName: last.normalized_name!,
            id: last.id,
          })
        : encodeEventCursor({
            kind: 'list',
            query: '',
            updatedAt: last.updated_at.toISOString(),
            id: last.id,
          });
    }

    return { items, nextCursor, hasMore };
  }

  private async listRows(limit: number, cursor?: EventCursorState): Promise<EventRow[]> {
    const listCursor = cursor?.kind === 'list' ? cursor : undefined;
    const parameters: unknown[] = [];
    const condition = listCursor ? `where (updated_at, id) < ($1::timestamptz, $2::uuid)` : '';
    if (listCursor) parameters.push(listCursor.updatedAt, listCursor.id);
    parameters.push(limit);

    const result = await this.pool.query<EventRow>(
      `select id, name, description, keywords, created_at, updated_at
       from abstract_events
       ${condition}
       order by updated_at desc, id desc
       limit $${parameters.length}`,
      parameters,
    );
    return result.rows;
  }

  private async searchRows(
    query: string,
    limit: number,
    cursor?: EventCursorState | EventCandidateCursorState,
  ): Promise<EventRow[]> {
    const searchCursor =
      cursor?.kind === 'search' || cursor?.kind === 'candidate' ? cursor : undefined;
    const escaped = escapeLike(query);
    const parameters: unknown[] = [query, `${escaped}%`, `%${escaped}%`];
    const cursorCondition = searchCursor
      ? `where (r.rank, e.normalized_name, e.id) > ($4::int, $5::text, $6::uuid)`
      : '';
    if (searchCursor) {
      parameters.push(searchCursor.rank, searchCursor.normalizedName, searchCursor.id);
    }
    parameters.push(limit);

    const result = await this.pool.query<EventRow>(
      `with matches as (
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
         select e.id,
                case when exists (
                       select 1 from unnest(e.keywords) keyword
                       where lower(keyword) = $1
                     ) then 5 else 6 end as rank
         from abstract_events e
         where exists (
           select 1 from unnest(e.keywords) keyword
           where lower(keyword) like $3 escape '\\'
         )
       ), ranked as (
         select id, min(rank)::int as rank
         from matches
         group by id
       )
       select e.id, e.name, e.description, e.keywords, e.created_at, e.updated_at,
              e.normalized_name, r.rank
       from ranked r
       join abstract_events e on e.id = r.id
       ${cursorCondition}
       order by r.rank, e.normalized_name, e.id
       limit $${parameters.length}`,
      parameters,
    );
    return result.rows;
  }

  async findCandidates(query: EventCandidateQuery): Promise<EventCandidateListResponse> {
    const normalizedQuery = normalizeQuery(query.q);
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
      `select id, name, description, keywords, created_at, updated_at
       from abstract_events
       where id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) return null;
    const aliases = await this.loadAliases([id]);
    return createDetail(row, aliases.get(id) ?? []);
  }

  async create(input: EventFormInput): Promise<EventDetail> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const inserted = await client.query<EventRow>(
        `insert into abstract_events (name, description, keywords)
         values ($1, $2, $3::text[])
         returning id, name, description, keywords, created_at, updated_at`,
        [input.name, input.description, input.keywords],
      );
      const row = inserted.rows[0]!;
      await this.insertAliases(client, row.id, input.aliases);
      await client.query('commit');
      return createDetail(row, input.aliases);
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
             keywords = $4::text[],
             updated_at = clock_timestamp()
         where id = $1
         returning id, name, description, keywords, created_at, updated_at`,
        [id, input.name, input.description, input.keywords],
      );
      const row = updated.rows[0];
      if (!row) {
        await client.query('rollback');
        return null;
      }
      await client.query('delete from event_aliases where event_id = $1', [id]);
      await this.insertAliases(client, id, input.aliases);
      await client.query('commit');
      return createDetail(row, input.aliases);
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
}
