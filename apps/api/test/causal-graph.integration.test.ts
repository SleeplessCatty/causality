import type { CausalGraphResponse } from '@causality/contracts';
import { Pool } from 'pg';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app.js';
import { runMigrations } from '../src/database/migrate.js';
import { PostgresCausalGraphRepository } from '../src/features/causal-graph/causalGraphRepository.js';

const eventIds = {
  a: 'a0000000-0000-4000-8000-000000000001',
  b: 'a0000000-0000-4000-8000-000000000002',
  c: 'a0000000-0000-4000-8000-000000000003',
  d: 'a0000000-0000-4000-8000-000000000004',
  isolated: 'a0000000-0000-4000-8000-000000000005',
} as const;

const relationIds = {
  ab: 'b0000000-0000-4000-8000-000000000001',
  ac: 'b0000000-0000-4000-8000-000000000002',
  bd: 'b0000000-0000-4000-8000-000000000003',
  cd: 'b0000000-0000-4000-8000-000000000004',
  da: 'b0000000-0000-4000-8000-000000000005',
  ba: 'b0000000-0000-4000-8000-000000000006',
} as const;

function graphUrl(
  centerEventId: string,
  direction: 'upstream' | 'downstream' | 'both',
  suffix = '',
): string {
  return `/api/causal-graph?centerEventId=${centerEventId}&direction=${direction}${suffix}`;
}

describe.sequential('causal graph REST API', () => {
  let container: StartedTestContainer | undefined;
  let pool: Pool | undefined;
  let app: ReturnType<typeof buildApp> | undefined;

  beforeAll(async () => {
    container = await new GenericContainer('postgres:18.4-alpine')
      .withEnvironment({
        POSTGRES_DB: 'causality_graph_test',
        POSTGRES_USER: 'causality',
        POSTGRES_PASSWORD: 'causality',
      })
      .withExposedPorts(5432)
      .withHealthCheck({
        test: ['CMD-SHELL', 'pg_isready -U causality -d causality_graph_test'],
        interval: 1_000,
        timeout: 3_000,
        retries: 30,
      })
      .withWaitStrategy(Wait.forHealthCheck())
      .withStartupTimeout(120_000)
      .start();
    pool = new Pool({
      connectionString: `postgresql://causality:causality@${container.getHost()}:${container.getMappedPort(5432)}/causality_graph_test`,
    });
    await runMigrations(pool);
    await pool.query(
      `insert into abstract_events (id, name)
       values ($1, '事件 A'), ($2, '事件 B'), ($3, '事件 C'), ($4, '事件 D'), ($5, '孤立事件')`,
      [eventIds.a, eventIds.b, eventIds.c, eventIds.d, eventIds.isolated],
    );
    await pool.query(
      `insert into causal_relations (id, cause_event_id, effect_event_id, confidence)
       values ($1, $7, $8, 90),
              ($2, $7, $9, 90),
              ($3, $8, $10, 80),
              ($4, $9, $10, 70),
              ($5, $10, $7, 60),
              ($6, $8, $7, 50)`,
      [
        relationIds.ab,
        relationIds.ac,
        relationIds.bd,
        relationIds.cd,
        relationIds.da,
        relationIds.ba,
        eventIds.a,
        eventIds.b,
        eventIds.c,
        eventIds.d,
      ],
    );
    const caseIds = Array.from(
      { length: 6 },
      (_, index) => `c0000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    );
    await pool.query(
      `insert into concrete_cases (id, content)
       values ($1, '图测试案例1'), ($2, '图测试案例2'), ($3, '图测试案例3'),
              ($4, '图测试案例4'), ($5, '图测试案例5'), ($6, '图测试案例6')`,
      caseIds,
    );
    await pool.query(
      `insert into causal_relation_cases (causal_relation_id, concrete_case_id)
       values ($1, $4), ($1, $5), ($2, $6), ($3, $7), ($3, $8), ($3, $9)`,
      [relationIds.ab, relationIds.ac, relationIds.cd, ...caseIds],
    );
    app = buildApp({ logger: false, checkDatabase: async () => true, databasePool: pool });
    await app.ready();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await container?.stop();
  });

  it('returns a stable downstream graph with complete internal relations', async () => {
    const response = await app!.inject({
      method: 'GET',
      url: graphUrl(eventIds.a, 'downstream'),
    });
    const graph = response.json<CausalGraphResponse>();

    expect(response.statusCode).toBe(200);
    expect(graph.nodes.map((event) => event.id)).toEqual([
      eventIds.a,
      eventIds.b,
      eventIds.c,
      eventIds.d,
    ]);
    expect(graph.relations.map((relation) => relation.id)).toEqual([
      relationIds.ab,
      relationIds.ac,
      relationIds.bd,
      relationIds.cd,
      relationIds.da,
      relationIds.ba,
    ]);
    expect(graph.relations.find((relation) => relation.id === relationIds.ab)?.caseCount).toBe(2);
    expect(graph.relations.find((relation) => relation.id === relationIds.cd)?.caseCount).toBe(3);
    expect(graph.meta).toEqual({
      centerEventId: eventIds.a,
      direction: 'downstream',
      nodeLimit: 20,
      relationLimit: 200,
      minConfidence: 0,
      minCaseCount: 0,
      nodeCount: 4,
      relationCount: 6,
      stopReason: 'exhausted',
    });
  });

  it('supports upstream and a unified both-direction queue', async () => {
    const upstream = (
      await app!.inject({ method: 'GET', url: graphUrl(eventIds.a, 'upstream') })
    ).json<CausalGraphResponse>();
    const both = (
      await app!.inject({ method: 'GET', url: graphUrl(eventIds.a, 'both') })
    ).json<CausalGraphResponse>();

    expect(upstream.nodes.map((event) => event.id)).toEqual([
      eventIds.a,
      eventIds.d,
      eventIds.b,
      eventIds.c,
    ]);
    expect(both.nodes.map((event) => event.id)).toEqual([
      eventIds.a,
      eventIds.b,
      eventIds.c,
      eventIds.d,
    ]);
  });

  it('applies confidence and case-count filters before traversal', async () => {
    const confidence = (
      await app!.inject({
        method: 'GET',
        url: graphUrl(eventIds.a, 'downstream', '&minConfidence=80'),
      })
    ).json<CausalGraphResponse>();
    const cases = (
      await app!.inject({
        method: 'GET',
        url: graphUrl(eventIds.a, 'downstream', '&minCaseCount=2'),
      })
    ).json<CausalGraphResponse>();
    const combined = (
      await app!.inject({
        method: 'GET',
        url: graphUrl(eventIds.a, 'downstream', '&minConfidence=90&minCaseCount=2'),
      })
    ).json<CausalGraphResponse>();

    expect(confidence.nodes.map((event) => event.id)).toEqual([
      eventIds.a,
      eventIds.b,
      eventIds.c,
      eventIds.d,
    ]);
    expect(confidence.relations).toHaveLength(3);
    expect(cases.nodes.map((event) => event.id)).toEqual([eventIds.a, eventIds.b]);
    expect(cases.relations.map((relation) => relation.id)).toEqual([relationIds.ab]);
    expect(combined.relations.map((relation) => relation.id)).toEqual([relationIds.ab]);
  });

  it('returns an isolated center and stable repeated results', async () => {
    const first = await app!.inject({
      method: 'GET',
      url: graphUrl(eventIds.isolated, 'both', '&limit=100'),
    });
    const second = await app!.inject({
      method: 'GET',
      url: graphUrl(eventIds.isolated, 'both', '&limit=100'),
    });

    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual(second.json());
    expect(first.json<CausalGraphResponse>()).toMatchObject({
      nodes: [{ id: eventIds.isolated, name: '孤立事件' }],
      relations: [],
      meta: { nodeLimit: 100, relationLimit: 1_000, stopReason: 'exhausted' },
    });
  });

  it('returns 404 for a missing center and 400 for invalid query parameters', async () => {
    const missing = await app!.inject({
      method: 'GET',
      url: graphUrl('ffffffff-ffff-4fff-8fff-ffffffffffff', 'both'),
    });
    const invalid = await app!.inject({
      method: 'GET',
      url: graphUrl(eventIds.a, 'both', '&limit=30'),
    });

    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ code: 'EVENT_NOT_FOUND', message: '中心事件不存在' });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('publishes the causal graph endpoint in OpenAPI', async () => {
    const document = (await app!.inject({ method: 'GET', url: '/api/openapi.json' })).json<{
      paths: Record<string, unknown>;
    }>();
    expect(document.paths).toHaveProperty('/api/causal-graph');
  });

  it('keeps all reads in one repeatable-read snapshot', async () => {
    const repository = new PostgresCausalGraphRepository(pool!);
    const names = await repository.withSnapshot(async (snapshot) => {
      const before = await snapshot.findEvent(eventIds.a);
      await pool!.query(`update abstract_events set name = '事件 A 已修改' where id = $1`, [
        eventIds.a,
      ]);
      const after = await snapshot.findEvent(eventIds.a);
      return [before?.name, after?.name];
    });

    expect(names).toEqual(['事件 A', '事件 A']);
    await pool!.query(`update abstract_events set name = '事件 A' where id = $1`, [eventIds.a]);
  });

  it('can use endpoint and case-link indexes for graph queries', async () => {
    const client = await pool!.connect();
    try {
      await client.query('begin');
      await client.query('set local enable_seqscan = off');
      const downstream = await client.query<{ 'QUERY PLAN': string }>(
        `explain
         select id from causal_relations
         where cause_event_id = any($1::uuid[])`,
        [[eventIds.a]],
      );
      const upstream = await client.query<{ 'QUERY PLAN': string }>(
        `explain
         select id from causal_relations
         where effect_event_id = any($1::uuid[])`,
        [[eventIds.a]],
      );
      const cases = await client.query<{ 'QUERY PLAN': string }>(
        `explain
         select count(*) from causal_relation_cases
         where causal_relation_id = $1`,
        [relationIds.ab],
      );
      const plans = {
        downstream: downstream.rows.map((row) => row['QUERY PLAN']).join('\n'),
        upstream: upstream.rows.map((row) => row['QUERY PLAN']).join('\n'),
        cases: cases.rows.map((row) => row['QUERY PLAN']).join('\n'),
      };

      expect(plans.downstream).toContain('causal_relations_cause_event_id_idx');
      expect(plans.upstream).toContain('causal_relations_effect_event_id_idx');
      expect(plans.cases).toContain('causal_relation_cases_relation_linked_idx');
      await client.query('rollback');
    } finally {
      client.release();
    }
  });
});

describe('PostgresCausalGraphRepository transaction boundary', () => {
  it('commits and releases a successful read-only snapshot', async () => {
    const commands: string[] = [];
    const release = vi.fn();
    const client = {
      query: vi.fn(async (sql: string) => {
        commands.push(sql);
        return { rows: [] };
      }),
      release,
    };
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;

    await expect(
      new PostgresCausalGraphRepository(pool).withSnapshot(async () => 'result'),
    ).resolves.toBe('result');

    expect(commands).toEqual([
      'begin transaction isolation level repeatable read read only',
      'commit',
    ]);
    expect(release).toHaveBeenCalledOnce();
  });

  it('rolls back and releases a failed read-only snapshot', async () => {
    const commands: string[] = [];
    const release = vi.fn();
    const failure = new Error('query failed');
    const client = {
      query: vi.fn(async (sql: string) => {
        commands.push(sql);
        return { rows: [] };
      }),
      release,
    };
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;

    await expect(
      new PostgresCausalGraphRepository(pool).withSnapshot(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(commands).toEqual([
      'begin transaction isolation level repeatable read read only',
      'rollback',
    ]);
    expect(release).toHaveBeenCalledOnce();
  });
});
