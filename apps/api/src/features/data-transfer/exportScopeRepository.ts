import type { ExportCounts, ExportPreviewInput } from '@causality/contracts';
import type { PoolClient } from 'pg';

import type { CaseExportRow, EventExportRow, RelationExportRow } from './dataTransferTypes.js';

export class ExportScopeError extends Error {
  public constructor(
    public readonly code: 'EXPORT_START_EVENT_NOT_FOUND',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ExportScopeError';
  }
}

export interface ExportScopeRepository {
  materialize(client: PoolClient, input: ExportPreviewInput): Promise<ExportCounts>;
  streamEvents(client: PoolClient, batchSize: number): AsyncIterable<EventExportRow[]>;
  streamCases(client: PoolClient, batchSize: number): AsyncIterable<CaseExportRow[]>;
  streamRelations(client: PoolClient, batchSize: number): AsyncIterable<RelationExportRow[]>;
}

export function normalizeExportInput(input: ExportPreviewInput): ExportPreviewInput {
  if (input.type === 'full') return input;
  return { ...input, startEventIds: [...new Set(input.startEventIds)] };
}

export async function assertStartEventsExist(
  client: PoolClient,
  startEventIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(startEventIds)];
  const result = await client.query<{ count: number | string }>(
    `select count(*)::int as count
     from abstract_events
     where id = any($1::uuid[])`,
    [ids],
  );
  if (Number(result.rows[0]?.count ?? 0) !== ids.length) {
    throw new ExportScopeError('EXPORT_START_EVENT_NOT_FOUND', '起始原子事件不存在');
  }
}

async function createScopeTables(client: PoolClient): Promise<void> {
  await client.query(`
    create temp table if not exists export_scope_events (
      id uuid primary key
    ) on commit drop;
    create temp table if not exists export_scope_relations (
      id uuid primary key
    ) on commit drop;
    create temp table if not exists export_scope_cases (
      id uuid primary key
    ) on commit drop;
    create temp table if not exists export_scope_frontier (
      id uuid primary key,
      depth smallint not null
    ) on commit drop;
    truncate export_scope_events, export_scope_relations, export_scope_cases,
      export_scope_frontier;
  `);
}

async function insertFilteredScope(
  client: PoolClient,
  input: Extract<ExportPreviewInput, { type: 'filtered' }>,
): Promise<void> {
  await assertStartEventsExist(client, input.startEventIds);

  await client.query(
    `insert into export_scope_frontier (id, depth)
     select id, 0
     from unnest($1::uuid[]) as starts(id)
     on conflict do nothing`,
    [input.startEventIds],
  );

  for (let depth = 0; depth < input.depth; depth += 1) {
    const expansion = await client.query(
      `with steps as materialized (
         select relation.id as relation_id,
                case
                  when ($1::text in ('downstream', 'both')
                    and relation.cause_event_id = frontier.id)
                    then relation.effect_event_id
                  else relation.cause_event_id
                end as next_event_id
         from export_scope_frontier frontier
         join causal_relations relation
           on ($1::text in ('downstream', 'both') and relation.cause_event_id = frontier.id)
           or ($1::text in ('upstream', 'both') and relation.effect_event_id = frontier.id)
         where frontier.depth = $2
       ), inserted_relations as (
         insert into export_scope_relations (id)
         select distinct relation_id from steps
         on conflict do nothing
       )
       insert into export_scope_frontier (id, depth)
       select distinct next_event_id, $3::smallint
       from steps
       on conflict do nothing`,
      [input.direction, depth, depth + 1],
    );
    if ((expansion.rowCount ?? 0) === 0) break;
  }

  await client.query(
    `insert into export_scope_events (id)
     select id from export_scope_frontier
     on conflict do nothing`,
  );
  await client.query(
    `insert into export_scope_cases (id)
     select distinct link.concrete_case_id
     from causal_relation_cases link
     join export_scope_relations scope on scope.id = link.causal_relation_id
     on conflict do nothing`,
  );
}

export class PostgresExportScopeRepository implements ExportScopeRepository {
  public async materialize(
    client: PoolClient,
    rawInput: ExportPreviewInput,
  ): Promise<ExportCounts> {
    const input = normalizeExportInput(rawInput);
    await createScopeTables(client);
    if (input.type === 'full') {
      await client.query('insert into export_scope_events (id) select id from abstract_events');
      await client.query('insert into export_scope_relations (id) select id from causal_relations');
      await client.query('insert into export_scope_cases (id) select id from concrete_cases');
    } else {
      await insertFilteredScope(client, input);
    }

    const result = await client.query<{
      events: number | string;
      cases: number | string;
      relations: number | string;
    }>(`
      select
        (select count(*)::int from export_scope_events) as events,
        (select count(*)::int from export_scope_cases) as cases,
        (select count(*)::int from export_scope_relations) as relations
    `);
    const row = result.rows[0]!;
    return {
      events: Number(row.events),
      cases: Number(row.cases),
      relations: Number(row.relations),
    };
  }

  public async *streamEvents(
    client: PoolClient,
    batchSize: number,
  ): AsyncIterable<EventExportRow[]> {
    let lastId: string | undefined;
    while (true) {
      const result = await client.query<EventExportRow & { id: string }>(
        `select event.id, event.name, event.description,
                coalesce((
                  select array_agg(alias.alias order by alias.alias)
                  from event_aliases alias where alias.event_id = event.id
                ), '{}') as aliases,
                coalesce((
                  select array_agg(keyword.keyword order by keyword.position)
                  from event_keywords keyword where keyword.event_id = event.id
                ), '{}') as keywords
         from export_scope_events scope
         join abstract_events event on event.id = scope.id
         ${lastId === undefined ? '' : 'where event.id > $1'}
         order by event.id
         limit $${lastId === undefined ? 1 : 2}`,
        lastId === undefined ? [batchSize] : [lastId, batchSize],
      );
      if (result.rows.length === 0) return;
      lastId = result.rows.at(-1)!.id;
      yield result.rows.map(({ id: _id, ...row }) => row);
    }
  }

  public async *streamCases(client: PoolClient, batchSize: number): AsyncIterable<CaseExportRow[]> {
    let lastId: string | undefined;
    while (true) {
      const result = await client.query<CaseExportRow & { id: string }>(
        `select concrete_case.id, concrete_case.content
         from export_scope_cases scope
         join concrete_cases concrete_case on concrete_case.id = scope.id
         ${lastId === undefined ? '' : 'where concrete_case.id > $1'}
         order by concrete_case.id
         limit $${lastId === undefined ? 1 : 2}`,
        lastId === undefined ? [batchSize] : [lastId, batchSize],
      );
      if (result.rows.length === 0) return;
      lastId = result.rows.at(-1)!.id;
      yield result.rows.map(({ id: _id, ...row }) => row);
    }
  }

  public async *streamRelations(
    client: PoolClient,
    batchSize: number,
  ): AsyncIterable<RelationExportRow[]> {
    let lastId: string | undefined;
    while (true) {
      const result = await client.query<RelationExportRow & { id: string }>(
        `select relation.id,
                cause.name as "causeEventName",
                effect.name as "effectEventName",
                relation.confidence,
                relation.description,
                coalesce((
                  select array_agg(concrete_case.content order by concrete_case.content)
                  from causal_relation_cases link
                  join concrete_cases concrete_case on concrete_case.id = link.concrete_case_id
                  where link.causal_relation_id = relation.id
                ), '{}') as "caseContents"
         from export_scope_relations scope
         join causal_relations relation on relation.id = scope.id
         join abstract_events cause on cause.id = relation.cause_event_id
         join abstract_events effect on effect.id = relation.effect_event_id
         ${lastId === undefined ? '' : 'where relation.id > $1'}
         order by relation.id
         limit $${lastId === undefined ? 1 : 2}`,
        lastId === undefined ? [batchSize] : [lastId, batchSize],
      );
      if (result.rows.length === 0) return;
      lastId = result.rows.at(-1)!.id;
      yield result.rows.map(({ id: _id, ...row }) => row);
    }
  }
}
