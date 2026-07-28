import { Readable } from 'node:stream';

import type { ExportCounts, ExportPreparationInput } from '@causality/contracts';
import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { parseImportCsv } from '../src/features/data-transfer/csvCodec.js';
import { PostgresExportRequestRepository } from '../src/features/data-transfer/exportRequestRepository.js';
import {
  PostgresExportScopeRepository,
  type ExportScopeRepository,
} from '../src/features/data-transfer/exportScopeRepository.js';
import { ExportService } from '../src/features/data-transfer/exportService.js';
import { PostgresImportRepository } from '../src/features/data-transfer/importRepository.js';
import { ImportService } from '../src/features/data-transfer/importService.js';
import type {
  CaseExportRow,
  EventExportRow,
  RelationExportRow,
} from '../src/features/data-transfer/dataTransferTypes.js';
import {
  startPostgresTestContext,
  type StartedPostgresTestContext,
} from './support/postgresTestContext.js';

const eventIds = {
  cause: '91000000-0000-4000-8000-000000000001',
  effect: '91000000-0000-4000-8000-000000000002',
  afterPreview: '91000000-0000-4000-8000-000000000003',
} as const;
const relationId = '92000000-0000-4000-8000-000000000001';
const caseIds = {
  first: '93000000-0000-4000-8000-000000000001',
  second: '93000000-0000-4000-8000-000000000002',
  standalone: '93000000-0000-4000-8000-000000000003',
} as const;

async function resetDatabase(pool: Pool): Promise<void> {
  await pool.query(`
    delete from export_requests;
    delete from import_batches;
    delete from causal_relation_cases;
    delete from causal_relations;
    delete from event_aliases;
    delete from event_keywords;
    delete from abstract_events;
    delete from concrete_cases;
  `);
}

async function seedExportGraph(pool: Pool): Promise<void> {
  await pool.query(
    `insert into abstract_events (id, name, description) values
       ($1, '事件 A', E'说明,"引号"\\n第二行'),
       ($2, '事件 B', null)`,
    [eventIds.cause, eventIds.effect],
  );
  await pool.query(
    `insert into event_aliases (id, event_id, alias) values
       ('94000000-0000-4000-8000-000000000003', $1, 'Zulu'),
       ('94000000-0000-4000-8000-000000000002', $1, 'alpha two'),
       ('94000000-0000-4000-8000-000000000001', $1, 'alpha one')`,
    [eventIds.cause],
  );
  await pool.query(
    `insert into event_keywords (id, event_id, keyword, position) values
       ('95000000-0000-4000-8000-000000000002', $1, '第二关键词', 2),
       ('95000000-0000-4000-8000-000000000001', $1, '第一关键词', 1)`,
    [eventIds.cause],
  );
  await pool.query(
    `insert into concrete_cases (id, content) values
       ($1, '案例,一'),
       ($2, '案例"二'),
       ($3, '独立案例')`,
    Object.values(caseIds),
  );
  await pool.query(
    `insert into causal_relations (
       id, cause_event_id, effect_event_id,
       confidence, baseline_confidence, baseline_case_count, description
     ) values ($1, $2, $3, 87.4321, 87.4321, 2, '关系说明')`,
    [relationId, eventIds.cause, eventIds.effect],
  );
  await pool.query(
    `insert into causal_relation_cases (
       causal_relation_id, concrete_case_id, linked_at
     ) values
       ($1, $2, '2026-07-27T10:00:00Z'),
       ($1, $3, '2026-07-27T09:00:00Z')`,
    [relationId, caseIds.first, caseIds.second],
  );
}

async function preview(
  context: StartedPostgresTestContext,
  body: ExportPreparationInput = { type: 'full' },
): Promise<string> {
  const response = await context.app.inject({
    method: 'POST',
    url: '/api/data-transfers/exports/prepare',
    payload: body,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{ token: string }>().token;
}

async function businessSnapshot(pool: Pool): Promise<unknown> {
  const events = await pool.query(
    `select event.name,
            event.description,
            coalesce((
              select jsonb_agg(alias.alias order by alias.normalized_alias, alias.id)
              from event_aliases alias where alias.event_id = event.id
            ), '[]') as aliases,
            coalesce((
              select jsonb_agg(keyword.keyword order by keyword.position, keyword.id)
              from event_keywords keyword where keyword.event_id = event.id
            ), '[]') as keywords
     from abstract_events event
     order by event.name`,
  );
  const cases = await pool.query(`select content from concrete_cases order by content`);
  const relations = await pool.query(
    `select cause.name as cause,
            effect.name as effect,
            relation.confidence,
            relation.description,
            coalesce((
              select jsonb_agg(concrete_case.content order by concrete_case.content)
              from causal_relation_cases link
              join concrete_cases concrete_case on concrete_case.id = link.concrete_case_id
              where link.causal_relation_id = relation.id
            ), '[]') as cases
     from causal_relations relation
     join abstract_events cause on cause.id = relation.cause_event_id
     join abstract_events effect on effect.id = relation.effect_event_id
     order by cause.name, effect.name`,
  );
  return { events: events.rows, cases: cases.rows, relations: relations.rows };
}

async function expectPoolReleased(pool: Pool): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  expect(pool.waitingCount).toBe(0);
  expect(pool.idleCount).toBe(pool.totalCount);
}

class BackpressureScopeRepository implements ExportScopeRepository {
  public eventPulls = 0;

  public async materialize(): Promise<ExportCounts> {
    return { events: 100, cases: 0, relations: 0 };
  }

  public async *streamEvents(): AsyncIterable<EventExportRow[]> {
    for (let index = 0; index < 100; index += 1) {
      this.eventPulls += 1;
      yield [
        {
          name: `事件 ${index}`,
          description: 'x'.repeat(8_000),
          aliases: [],
          keywords: [],
        },
      ];
    }
  }

  public async *streamCases(): AsyncIterable<CaseExportRow[]> {
    yield* [];
  }

  public async *streamRelations(): AsyncIterable<RelationExportRow[]> {
    yield* [];
  }
}

class FailingScopeRepository implements ExportScopeRepository {
  public async materialize(): Promise<ExportCounts> {
    return { events: 1, cases: 0, relations: 0 };
  }

  public async *streamEvents(client: PoolClient): AsyncIterable<EventExportRow[]> {
    await client.query('create table export_stream_failure_marker (id integer)');
    yield await Promise.reject<EventExportRow[]>(new Error('synthetic export read failure'));
  }

  public async *streamCases(): AsyncIterable<CaseExportRow[]> {
    yield* [];
  }

  public async *streamRelations(): AsyncIterable<RelationExportRow[]> {
    yield* [];
  }
}

class CommitFailingScopeRepository implements ExportScopeRepository {
  public async materialize(): Promise<ExportCounts> {
    return { events: 1, cases: 0, relations: 0 };
  }

  public async *streamEvents(client: PoolClient): AsyncIterable<EventExportRow[]> {
    await client.query(`
      create temp table export_deferred_failure_marker (
        value integer unique deferrable initially deferred
      ) on commit drop;
      insert into export_deferred_failure_marker (value) values (1), (1);
    `);
    yield [{ name: '提交失败事件', description: null, aliases: [], keywords: [] }];
  }

  public async *streamCases(): AsyncIterable<CaseExportRow[]> {
    yield* [];
  }

  public async *streamRelations(): AsyncIterable<RelationExportRow[]> {
    yield* [];
  }
}

class SetupAbortedScopeRepository implements ExportScopeRepository {
  private materializations = 0;

  public constructor(private readonly controller: AbortController) {}

  public async materialize(client: PoolClient): Promise<ExportCounts> {
    this.materializations += 1;
    if (this.materializations === 1) return { events: 0, cases: 0, relations: 0 };
    await client.query('create table export_setup_abort_marker (id integer)');
    this.controller.abort();
    return { events: 0, cases: 0, relations: 0 };
  }

  public async *streamEvents(): AsyncIterable<EventExportRow[]> {
    yield* [];
  }

  public async *streamCases(): AsyncIterable<CaseExportRow[]> {
    yield* [];
  }

  public async *streamRelations(): AsyncIterable<RelationExportRow[]> {
    yield* [];
  }
}

describe.sequential('consistent streaming CSV export', () => {
  let context: StartedPostgresTestContext | undefined;
  let pool: Pool | undefined;

  beforeAll(async () => {
    context = await startPostgresTestContext('causality_data_transfer_export_test');
    pool = context.pool;
  }, 120_000);

  beforeEach(async () => {
    await resetDatabase(pool!);
    await pool!.query('drop table if exists export_stream_failure_marker');
    await pool!.query('drop table if exists export_setup_abort_marker');
  });

  afterAll(async () => {
    await context?.close();
  });

  it('quotes every field and exports deduplicated events, cases, then relations in stable order', async () => {
    await seedExportGraph(pool!);
    const token = await preview(context!);
    await pool!.query(
      `insert into abstract_events (id, name, description)
       values ($1, '确认后事件', '导出快照应包含')`,
      [eventIds.afterPreview],
    );

    const response = await context!.app.inject({
      method: 'GET',
      url: `/api/data-transfers/exports/${token}`,
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
    const disposition = response.headers['content-disposition'];
    expect(disposition).toMatch(/^attachment; filename="causality-full-\d{8}-\d{6}\.csv"$/);
    const filename = disposition?.match(/^attachment; filename="([^"]+)"$/)?.[1];
    expect(filename).toBeDefined();
    expect(
      [...filename!].some((character) => {
        const codePoint = character.codePointAt(0)!;
        return codePoint <= 0x1f || codePoint === 0x7f || character === '"';
      }),
    ).toBe(false);
    expect(response.body).toBe(
      `"原子事件","事件 A","说明,""引号""\n第二行","alpha one;alpha two;Zulu","第一关键词;第二关键词"\n` +
        `"原子事件","事件 B","","",""\n` +
        `"原子事件","确认后事件","导出快照应包含","",""\n` +
        `"具体案例","案例,一"\n` +
        `"具体案例","案例""二"\n` +
        `"具体案例","独立案例"\n` +
        `"因果关系","事件 A","事件 B","87.4321","关系说明","案例""二","案例,一"\n`,
    );
    expect(response.body).not.toContain('\uFEFF');
    expect(response.body).not.toContain(relationId);
    expect(response.body).not.toContain('2026-07-27T');
    expect(response.body.match(/"原子事件"/g)).toHaveLength(3);
    expect(response.body.match(/"具体案例"/g)).toHaveLength(3);
    expect(response.body.match(/"因果关系"/g)).toHaveLength(1);
  });

  it('reimports the export into an empty database with equivalent business rows and links', async () => {
    await seedExportGraph(pool!);
    const token = await preview(context!);
    const source = await businessSnapshot(pool!);
    const download = await context!.app.inject({
      method: 'GET',
      url: `/api/data-transfers/exports/${token}`,
    });
    expect(download.statusCode, download.body).toBe(200);

    await resetDatabase(pool!);
    const parsed = await parseImportCsv(
      Readable.from([Buffer.from(download.body, 'utf8')]),
      new AbortController().signal,
    );
    await new ImportService(new PostgresImportRepository(pool!)).execute({
      filename: 'round-trip.csv',
      parseResult: parsed,
      signal: new AbortController().signal,
    });

    await expect(businessSnapshot(pool!)).resolves.toEqual(source);
  });

  it('returns a JSON error before CSV headers when a filtered start is deleted or a token expires', async () => {
    await seedExportGraph(pool!);
    await pool!.query(`insert into abstract_events (id, name) values ($1, '待删除起点')`, [
      eventIds.afterPreview,
    ]);
    const filteredToken = await preview(context!, {
      type: 'filtered',
      startEventIds: [eventIds.afterPreview],
      direction: 'both',
      depth: 2,
    });
    await pool!.query('delete from abstract_events where id = $1', [eventIds.afterPreview]);

    const deleted = await context!.app.inject({
      method: 'GET',
      url: `/api/data-transfers/exports/${filteredToken}`,
    });
    expect(deleted.statusCode).toBe(400);
    expect(deleted.headers['content-type']).toMatch(/^application\/json/);
    expect(deleted.headers['content-disposition']).toBeUndefined();
    expect(deleted.json()).toEqual({
      code: 'EXPORT_START_EVENT_NOT_FOUND',
      message: '起始原子事件不存在',
    });

    const expiredToken = await preview(context!);
    await pool!.query(
      `update export_requests
       set created_at = now() - interval '2 minutes',
           expires_at = now() - interval '1 minute'`,
    );
    const expired = await context!.app.inject({
      method: 'GET',
      url: `/api/data-transfers/exports/${expiredToken}`,
    });
    expect(expired.statusCode).toBe(410);
    expect(expired.headers['content-type']).toMatch(/^application\/json/);
    expect(expired.headers['content-disposition']).toBeUndefined();
    expect(expired.json()).toEqual({
      code: 'EXPORT_TOKEN_EXPIRED',
      message: '导出令牌已过期',
    });
  });

  it('does not pull the complete source while the CSV consumer is backpressured', async () => {
    const scope = new BackpressureScopeRepository();
    const service = new ExportService(
      pool!,
      scope,
      new PostgresExportRequestRepository({ createToken: () => 'b'.repeat(43) }),
    );
    const issued = await service.prepareExport({ type: 'full' });
    const controller = new AbortController();
    const exported = await service.openExportCsv(issued.token, controller.signal);

    await new Promise<void>((resolve) => {
      exported.stream.once('readable', resolve);
    });
    expect(scope.eventPulls).toBeGreaterThan(0);
    expect(scope.eventPulls).toBeLessThan(100);

    controller.abort();
    await exported.close();
    await expectPoolReleased(pool!);
  });

  it('rolls back and releases its client after cancellation or a database reader failure', async () => {
    await seedExportGraph(pool!);
    const liveService = new ExportService(
      pool!,
      new PostgresExportScopeRepository(),
      new PostgresExportRequestRepository({ createToken: () => 'c'.repeat(43) }),
    );
    const liveToken = await liveService.prepareExport({ type: 'full' });
    const controller = new AbortController();
    const liveExport = await liveService.openExportCsv(liveToken.token, controller.signal);
    const iterator = (liveExport.stream as Readable)[Symbol.asyncIterator]();
    await iterator.next();
    controller.abort();
    await liveExport.close();
    await expectPoolReleased(pool!);

    const failingService = new ExportService(
      pool!,
      new FailingScopeRepository(),
      new PostgresExportRequestRepository({ createToken: () => 'd'.repeat(43) }),
    );
    const failingToken = await failingService.prepareExport({ type: 'full' });
    const failedExport = await failingService.openExportCsv(
      failingToken.token,
      new AbortController().signal,
    );
    await expect(
      (async () => {
        for await (const chunk of failedExport.stream as Readable) {
          void chunk;
          // Drain until the controlled repository fails.
        }
      })(),
    ).rejects.toThrow('synthetic export read failure');
    await failedExport.close();

    const marker = await pool!.query<{ table_name: string | null }>(
      `select to_regclass('export_stream_failure_marker')::text as table_name`,
    );
    expect(marker.rows[0]?.table_name).toBeNull();
    await expectPoolReleased(pool!);
  });

  it('finishes cleanup after a commit-time failure without leaving a checked-out client', async () => {
    const service = new ExportService(
      pool!,
      new CommitFailingScopeRepository(),
      new PostgresExportRequestRepository({ createToken: () => 'e'.repeat(43) }),
    );
    const issued = await service.prepareExport({ type: 'full' });
    const exported = await service.openExportCsv(issued.token, new AbortController().signal);

    await expect(
      (async () => {
        for await (const chunk of exported.stream as Readable) {
          void chunk;
          // The deferred constraint fails only after the final CSV chunk.
        }
      })(),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(exported.close()).resolves.toBeUndefined();
    await expectPoolReleased(pool!);
  });

  it('rolls back when the client aborts during download scope preparation', async () => {
    const controller = new AbortController();
    const service = new ExportService(
      pool!,
      new SetupAbortedScopeRepository(controller),
      new PostgresExportRequestRepository({ createToken: () => 'f'.repeat(43) }),
    );
    const issued = await service.prepareExport({ type: 'full' });

    const outcome = await service.openExportCsv(issued.token, controller.signal).then(
      (exported) => ({ exported }),
      (error: unknown) => ({ error }),
    );
    if ('exported' in outcome) await outcome.exported.close();
    expect('error' in outcome ? outcome.error : undefined).toMatchObject({
      name: 'AbortError',
    });
    const marker = await pool!.query<{ table_name: string | null }>(
      `select to_regclass('export_setup_abort_marker')::text as table_name`,
    );
    expect(marker.rows[0]?.table_name).toBeNull();
    await expectPoolReleased(pool!);
  });
});
