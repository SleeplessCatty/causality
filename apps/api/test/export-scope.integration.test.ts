import { createHash } from 'node:crypto';

import type { ExportPreparationInput } from '@causality/contracts';
import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  PostgresExportRequestRepository,
  type ExportRequestError,
} from '../src/features/data-transfer/exportRequestRepository.js';
import {
  PostgresExportScopeRepository,
  type ExportScopeError,
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

async function materializedIds(client: PoolClient, input: ExportPreparationInput) {
  const repository = new PostgresExportScopeRepository();
  const counts = await repository.materialize(client, input);
  const events = await client.query<{ id: string }>(
    'select id from export_scope_events order by id',
  );
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

describe.sequential('Postgres export repositories', () => {
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

  it('uses a minimum-depth frontier across dense convergence, long revisits, and cycles', async () => {
    const denseEventIds = {
      root: '74000000-0000-4000-8000-000000000001',
      merge: '74000000-0000-4000-8000-000000000002',
      left: '74000000-0000-4000-8000-000000000003',
      p: '74000000-0000-4000-8000-000000000004',
      q: '74000000-0000-4000-8000-000000000005',
      next: '74000000-0000-4000-8000-000000000006',
      mid: '74000000-0000-4000-8000-000000000007',
      tail: '74000000-0000-4000-8000-000000000008',
    } as const;
    const denseRelationIds = {
      rootMerge: '75000000-0000-4000-8000-000000000001',
      rootLeft: '75000000-0000-4000-8000-000000000002',
      rootP: '75000000-0000-4000-8000-000000000003',
      rootQ: '75000000-0000-4000-8000-000000000004',
      mergeNext: '75000000-0000-4000-8000-000000000005',
      leftMid: '75000000-0000-4000-8000-000000000006',
      pMerge: '75000000-0000-4000-8000-000000000007',
      pQ: '75000000-0000-4000-8000-000000000008',
      qMerge: '75000000-0000-4000-8000-000000000009',
      qP: '75000000-0000-4000-8000-000000000010',
      nextTail: '75000000-0000-4000-8000-000000000011',
      midMerge: '75000000-0000-4000-8000-000000000012',
    } as const;
    await pool!.query(
      `insert into abstract_events (id, name)
       select id, name
       from jsonb_to_recordset($1::jsonb) as input(id uuid, name text)`,
      [
        JSON.stringify(
          Object.entries(denseEventIds).map(([name, id]) => ({ id, name: `密集-${name}` })),
        ),
      ],
    );
    await pool!.query(
      `insert into causal_relations (id, cause_event_id, effect_event_id, confidence)
       select id, cause_id, effect_id, 80
       from jsonb_to_recordset($1::jsonb)
         as input(id uuid, cause_id uuid, effect_id uuid)`,
      [
        JSON.stringify([
          {
            id: denseRelationIds.rootMerge,
            cause_id: denseEventIds.root,
            effect_id: denseEventIds.merge,
          },
          {
            id: denseRelationIds.rootLeft,
            cause_id: denseEventIds.root,
            effect_id: denseEventIds.left,
          },
          { id: denseRelationIds.rootP, cause_id: denseEventIds.root, effect_id: denseEventIds.p },
          { id: denseRelationIds.rootQ, cause_id: denseEventIds.root, effect_id: denseEventIds.q },
          {
            id: denseRelationIds.mergeNext,
            cause_id: denseEventIds.merge,
            effect_id: denseEventIds.next,
          },
          {
            id: denseRelationIds.leftMid,
            cause_id: denseEventIds.left,
            effect_id: denseEventIds.mid,
          },
          {
            id: denseRelationIds.pMerge,
            cause_id: denseEventIds.p,
            effect_id: denseEventIds.merge,
          },
          { id: denseRelationIds.pQ, cause_id: denseEventIds.p, effect_id: denseEventIds.q },
          {
            id: denseRelationIds.qMerge,
            cause_id: denseEventIds.q,
            effect_id: denseEventIds.merge,
          },
          { id: denseRelationIds.qP, cause_id: denseEventIds.q, effect_id: denseEventIds.p },
          {
            id: denseRelationIds.nextTail,
            cause_id: denseEventIds.next,
            effect_id: denseEventIds.tail,
          },
          {
            id: denseRelationIds.midMerge,
            cause_id: denseEventIds.mid,
            effect_id: denseEventIds.merge,
          },
        ]),
      ],
    );

    const result = await inTransaction((client) =>
      materializedIds(client, {
        type: 'filtered',
        startEventIds: [denseEventIds.root],
        direction: 'downstream',
        depth: 3,
      }),
    );

    expect(result).toEqual({
      counts: { events: 8, relations: 12, cases: 0 },
      events: Object.values(denseEventIds),
      relations: Object.values(denseRelationIds),
      cases: [],
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

  it('stores production tokens only by exact SHA-256 and returns stable read errors', async () => {
    await inTransaction(async (client) => {
      const createdAt = new Date('2026-07-27T08:00:00.000Z');
      const expiresAt = new Date('2026-07-27T08:10:00.000Z');
      const repository = new PostgresExportRequestRepository({
        now: () => new Date('2026-07-27T08:05:00.000Z'),
      });
      const rawToken = await repository.create(client, { type: 'full' }, createdAt, expiresAt);
      expect(rawToken).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(Buffer.from(rawToken, 'base64url').byteLength).toBeGreaterThanOrEqual(32);

      const expectedHash = createHash('sha256').update(rawToken).digest('hex');
      const stored = await client.query<{ stored: string; token_hash: string }>(
        `select token_hash, row_to_json(export_requests)::text as stored
         from export_requests
         where token_hash = $1`,
        [expectedHash],
      );
      expect(stored.rows).toHaveLength(1);
      expect(stored.rows[0]!.token_hash).toBe(expectedHash);
      expect(stored.rows[0]!.stored).not.toContain(rawToken);
      await expect(repository.read(client, rawToken)).resolves.toMatchObject({
        input: { type: 'full' },
        createdAt,
        expiresAt,
      });
      await expect(repository.read(client, 'z'.repeat(43))).rejects.toMatchObject({
        code: 'EXPORT_TOKEN_INVALID',
        message: '导出令牌无效',
      } satisfies Partial<ExportRequestError>);

      const expiredRepository = new PostgresExportRequestRepository({
        now: () => new Date('2026-07-27T08:11:00.000Z'),
      });
      await expect(expiredRepository.read(client, rawToken)).rejects.toMatchObject({
        code: 'EXPORT_TOKEN_EXPIRED',
        message: '导出令牌已过期',
      } satisfies Partial<ExportRequestError>);
    });
  });

  it('cleanup deletes only requests expired at or before issuance', async () => {
    await inTransaction(async (client) => {
      const repository = new PostgresExportRequestRepository();
      const createdAt = new Date('2026-07-27T07:00:00.000Z');
      const issuance = new Date('2026-07-27T08:00:00.000Z');
      await repository.create(
        client,
        { type: 'full' },
        createdAt,
        new Date('2026-07-27T07:30:00.000Z'),
      );
      await repository.create(client, { type: 'full' }, createdAt, issuance);
      await repository.create(
        client,
        { type: 'full' },
        createdAt,
        new Date('2026-07-27T08:30:00.000Z'),
      );

      await expect(repository.deleteExpired(client, issuance)).resolves.toBe(2);
      const remaining = await client.query<{ expires_at: Date }>(
        'select expires_at from export_requests',
      );
      expect(remaining.rows).toEqual([{ expires_at: new Date('2026-07-27T08:30:00.000Z') }]);
    });
  });
});
