import type { ExportPreviewInput } from '@causality/contracts';
import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  ExportScopeError,
  PostgresExportScopeRepository,
} from '../src/features/data-transfer/exportScopeRepository.js';
import {
  startPostgresTestContext,
  type StartedPostgresTestContext,
} from './support/postgresTestContext.js';

const eventIds = {
  a: '71000000-0000-4000-8000-000000000001',
  b: '71000000-0000-4000-8000-000000000002',
  c: '71000000-0000-4000-8000-000000000003',
  d: '71000000-0000-4000-8000-000000000004',
  e: '71000000-0000-4000-8000-000000000005',
  orphan: '71000000-0000-4000-8000-000000000006',
} as const;

const relationIds = {
  ab: '72000000-0000-4000-8000-000000000001',
  bc: '72000000-0000-4000-8000-000000000002',
  ca: '72000000-0000-4000-8000-000000000003',
  db: '72000000-0000-4000-8000-000000000004',
  ce: '72000000-0000-4000-8000-000000000005',
} as const;

const caseIds = {
  one: '73000000-0000-4000-8000-000000000001',
  two: '73000000-0000-4000-8000-000000000002',
  three: '73000000-0000-4000-8000-000000000003',
  orphan: '73000000-0000-4000-8000-000000000004',
} as const;

async function resetDatabase(pool: Pool): Promise<void> {
  await pool.query(`
    delete from export_requests;
    delete from causal_relation_cases;
    delete from causal_relations;
    delete from abstract_events;
    delete from concrete_cases;
  `);
}

async function seedGraph(pool: Pool): Promise<void> {
  await pool.query(
    `insert into abstract_events (id, name) values
       ($1, 'A'), ($2, 'B'), ($3, 'C'), ($4, 'D'), ($5, 'E'), ($6, '孤立事件')`,
    Object.values(eventIds),
  );
  await pool.query(
    `insert into causal_relations (id, cause_event_id, effect_event_id, confidence) values
       ($1, $2, $3, 80), ($4, $5, $6, 80), ($7, $8, $9, 80),
       ($10, $11, $12, 80), ($13, $14, $15, 80)`,
    [
      relationIds.ab,
      eventIds.a,
      eventIds.b,
      relationIds.bc,
      eventIds.b,
      eventIds.c,
      relationIds.ca,
      eventIds.c,
      eventIds.a,
      relationIds.db,
      eventIds.d,
      eventIds.b,
      relationIds.ce,
      eventIds.c,
      eventIds.e,
    ],
  );
  await pool.query(
    `insert into concrete_cases (id, content) values
       ($1, '共享案例一'), ($2, '循环案例二'), ($3, '分支案例三'), ($4, '孤立案例')`,
    Object.values(caseIds),
  );
  await pool.query(
    `insert into causal_relation_cases (causal_relation_id, concrete_case_id) values
       ($1, $2), ($3, $4), ($5, $6), ($7, $8), ($9, $10)`,
    [
      relationIds.ab,
      caseIds.one,
      relationIds.bc,
      caseIds.two,
      relationIds.ca,
      caseIds.two,
      relationIds.db,
      caseIds.three,
      relationIds.ce,
      caseIds.one,
    ],
  );
}

async function materializedIds(client: PoolClient, input: ExportPreviewInput) {
  const repository = new PostgresExportScopeRepository();
  const counts = await repository.materialize(client, input);
  const events = await client.query<{ id: string }>('select id from export_scope_events order by id');
  const relations = await client.query<{ id: string }>(
    'select id from export_scope_relations order by id',
  );
  const cases = await client.query<{ id: string }>('select id from export_scope_cases order by id');
  return {
    counts,
    events: events.rows.map((row) => row.id),
    relations: relations.rows.map((row) => row.id),
    cases: cases.rows.map((row) => row.id),
  };
}

describe.sequential('PostgresExportScopeRepository', () => {
  let context: StartedPostgresTestContext | undefined;
  let pool: Pool | undefined;

  beforeAll(async () => {
    context = await startPostgresTestContext('causality_export_scope_test');
    pool = context.pool;
  }, 120_000);

  beforeEach(async () => {
    await resetDatabase(pool!);
    await seedGraph(pool!);
  });

  afterAll(async () => {
    await context?.close();
  });

  async function inTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool!.connect();
    try {
      await client.query('begin');
      const result = await operation(client);
      await client.query('rollback');
      return result;
    } finally {
      client.release();
    }
  }

  it('traverses branches, a cycle, reverse relations, multiple starts, and shared cases exactly', async () => {
    const downstreamOne = await inTransaction((client) =>
      materializedIds(client, {
        type: 'filtered',
        startEventIds: [eventIds.a],
        direction: 'downstream',
        depth: 1,
      }),
    );
    expect(downstreamOne).toEqual({
      counts: { events: 2, relations: 1, cases: 1 },
      events: [eventIds.a, eventIds.b],
      relations: [relationIds.ab],
      cases: [caseIds.one],
    });

    const downstreamTen = await inTransaction((client) =>
      materializedIds(client, {
        type: 'filtered',
        startEventIds: [eventIds.a],
        direction: 'downstream',
        depth: 10,
      }),
    );
    expect(downstreamTen).toEqual({
      counts: { events: 4, relations: 4, cases: 2 },
      events: [eventIds.a, eventIds.b, eventIds.c, eventIds.e],
      relations: [relationIds.ab, relationIds.bc, relationIds.ca, relationIds.ce],
      cases: [caseIds.one, caseIds.two],
    });

    const upstreamTen = await inTransaction((client) =>
      materializedIds(client, {
        type: 'filtered',
        startEventIds: [eventIds.a],
        direction: 'upstream',
        depth: 10,
      }),
    );
    expect(upstreamTen).toEqual({
      counts: { events: 4, relations: 4, cases: 3 },
      events: [eventIds.a, eventIds.b, eventIds.c, eventIds.d],
      relations: [relationIds.ab, relationIds.bc, relationIds.ca, relationIds.db],
      cases: [caseIds.one, caseIds.two, caseIds.three],
    });

    const bothOne = await inTransaction((client) =>
      materializedIds(client, {
        type: 'filtered',
        startEventIds: [eventIds.b],
        direction: 'both',
        depth: 1,
      }),
    );
    expect(bothOne).toEqual({
      counts: { events: 4, relations: 3, cases: 3 },
      events: [eventIds.a, eventIds.b, eventIds.c, eventIds.d],
      relations: [relationIds.ab, relationIds.bc, relationIds.db],
      cases: [caseIds.one, caseIds.two, caseIds.three],
    });

    const multiStart = await inTransaction((client) =>
      materializedIds(client, {
        type: 'filtered',
        startEventIds: [eventIds.a, eventIds.d],
        direction: 'downstream',
        depth: 1,
      }),
    );
    expect(multiStart).toEqual({
      counts: { events: 3, relations: 2, cases: 2 },
      events: [eventIds.a, eventIds.b, eventIds.d],
      relations: [relationIds.ab, relationIds.db],
      cases: [caseIds.one, caseIds.three],
    });
  });

  it('uses the shortest revisit depth, while retaining an in-range cycle relation', async () => {
    const result = await inTransaction((client) =>
      materializedIds(client, {
        type: 'filtered',
        startEventIds: [eventIds.a],
        direction: 'downstream',
        depth: 3,
      }),
    );

    expect(result).toEqual({
      counts: { events: 4, relations: 4, cases: 2 },
      events: [eventIds.a, eventIds.b, eventIds.c, eventIds.e],
      relations: [relationIds.ab, relationIds.bc, relationIds.ca, relationIds.ce],
      cases: [caseIds.one, caseIds.two],
    });
  });

  it('includes all full-export orphans, but keeps a filtered orphan isolated', async () => {
    const full = await inTransaction((client) => materializedIds(client, { type: 'full' }));
    expect(full).toEqual({
      counts: { events: 6, relations: 5, cases: 4 },
      events: Object.values(eventIds),
      relations: Object.values(relationIds),
      cases: Object.values(caseIds),
    });

    const filteredOrphan = await inTransaction((client) =>
      materializedIds(client, {
        type: 'filtered',
        startEventIds: [eventIds.orphan],
        direction: 'both',
        depth: 10,
      }),
    );
    expect(filteredOrphan).toEqual({
      counts: { events: 1, relations: 0, cases: 0 },
      events: [eventIds.orphan],
      relations: [],
      cases: [],
    });
  });

  it('rejects any missing start event after de-duplicating starts', async () => {
    await expect(
      inTransaction((client) =>
        materializedIds(client, {
          type: 'filtered',
          startEventIds: [eventIds.a, eventIds.a, '71000000-0000-4000-8000-000000000099'],
          direction: 'both',
          depth: 1,
        }),
      ),
    ).rejects.toMatchObject({
      code: 'EXPORT_START_EVENT_NOT_FOUND',
      message: '起始原子事件不存在',
    } satisfies Partial<ExportScopeError>);
  });
});
