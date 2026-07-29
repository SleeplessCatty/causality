import {
  causalEvidenceBundleResponseSchema,
  causalPathResponseSchema,
  type CausalPathResponse,
} from '@causality/contracts';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { buildApp } from '../src/app.js';
import { startPostgresTestContext } from './support/postgresTestContext.js';

const eventIds = {
  a: 'a1000000-0000-4000-8000-000000000001',
  b: 'a1000000-0000-4000-8000-000000000002',
  c: 'a1000000-0000-4000-8000-000000000003',
  d: 'a1000000-0000-4000-8000-000000000004',
} as const;

const relationIds = {
  ab: 'b1000000-0000-4000-8000-000000000001',
  bc: 'b1000000-0000-4000-8000-000000000002',
  ac: 'b1000000-0000-4000-8000-000000000003',
  cb: 'b1000000-0000-4000-8000-000000000004',
} as const;

const caseIds = {
  ab: 'c1000000-0000-4000-8000-000000000001',
  bc: 'c1000000-0000-4000-8000-000000000002',
  abSecond: 'c1000000-0000-4000-8000-000000000003',
} as const;

const branchEventIds = [
  'd1000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000002',
  'd1000000-0000-4000-8000-000000000003',
  'd1000000-0000-4000-8000-000000000004',
  'd1000000-0000-4000-8000-000000000005',
] as const;

const branchRelationIds = [
  'e1000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000002',
  'e1000000-0000-4000-8000-000000000003',
  'e1000000-0000-4000-8000-000000000004',
  'e1000000-0000-4000-8000-000000000005',
  'e1000000-0000-4000-8000-000000000006',
  'e1000000-0000-4000-8000-000000000007',
  'e1000000-0000-4000-8000-000000000008',
] as const;

function pathUrl(sourceEventId: string, targetEventId: string, suffix = ''): string {
  return (
    '/api/causal-paths?sourceEventId=' + sourceEventId + '&targetEventId=' + targetEventId + suffix
  );
}

async function businessTableFingerprint(database: Pool): Promise<Record<string, unknown>> {
  const [events, relations, cases, links] = await Promise.all([
    database.query<{ value: unknown }>(
      "select json_build_object('count', count(*), 'maxUpdatedAt', max(updated_at)) as value from abstract_events",
    ),
    database.query<{ value: unknown }>(
      "select json_build_object('count', count(*), 'maxUpdatedAt', max(updated_at)) as value from causal_relations",
    ),
    database.query<{ value: unknown }>(
      "select json_build_object('count', count(*), 'maxUpdatedAt', max(updated_at)) as value from concrete_cases",
    ),
    database.query<{ value: unknown }>(
      "select json_build_object('count', count(*), 'maxLinkedAt', max(linked_at)) as value from causal_relation_cases",
    ),
  ]);

  return {
    abstractEvents: events.rows[0]!.value,
    causalRelations: relations.rows[0]!.value,
    concreteCases: cases.rows[0]!.value,
    causalRelationCases: links.rows[0]!.value,
  };
}

describe.sequential('causal evidence REST API', () => {
  let context: Awaited<ReturnType<typeof startPostgresTestContext>> | undefined;
  let pool: Pool | undefined;
  let app: ReturnType<typeof buildApp> | undefined;

  beforeAll(async () => {
    context = await startPostgresTestContext('causality_evidence_test');
    ({ pool, app } = context);

    await pool.query(
      [
        'insert into abstract_events (id, name)',
        "values ($1, '事件 A'), ($2, '事件 B'), ($3, '事件 C'), ($4, '事件 D')",
      ].join(' '),
      [eventIds.a, eventIds.b, eventIds.c, eventIds.d],
    );
    await pool.query(
      [
        'insert into causal_relations (',
        'id, cause_event_id, effect_event_id,',
        'confidence, baseline_confidence, baseline_case_count',
        ') values',
        '($1, $5, $6, 80, 80, 1),',
        '($2, $6, $7, 70, 70, 1),',
        '($3, $5, $7, 20, 20, 0),',
        '($4, $7, $6, 90, 90, 0)',
      ].join(' '),
      [
        relationIds.ab,
        relationIds.bc,
        relationIds.ac,
        relationIds.cb,
        eventIds.a,
        eventIds.b,
        eventIds.c,
      ],
    );
    await pool.query(
      [
        'insert into concrete_cases (id, content)',
        "values ($1, '事件 A 后发生事件 B'), ($2, '事件 B 后发生事件 C')",
      ].join(' '),
      [caseIds.ab, caseIds.bc],
    );
    await pool.query(
      [
        'insert into causal_relation_cases (causal_relation_id, concrete_case_id)',
        'values ($1, $3), ($2, $4)',
      ].join(' '),
      [relationIds.ab, relationIds.bc, caseIds.ab, caseIds.bc],
    );
  }, 120_000);

  afterAll(async () => {
    await context?.close();
  });

  it('returns a stable direct path before a qualified two-hop path', async () => {
    const response = await app!.inject({
      method: 'GET',
      url: pathUrl(eventIds.a, eventIds.c),
    });
    const body = causalPathResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body.paths.map((path) => path.relations.map((relation) => relation.id))).toEqual([
      [relationIds.ac],
      [relationIds.ab, relationIds.bc],
    ]);
    expect(body.paths[1]).toMatchObject({
      hopCount: 2,
      minimumConfidence: 70,
      totalCaseCount: 2,
    });
    expect(body).toMatchObject({
      sourceEvent: { id: eventIds.a, name: '事件 A' },
      targetEvent: { id: eventIds.c, name: '事件 C' },
      truncated: false,
      truncatedReason: null,
    } satisfies Partial<CausalPathResponse>);
  });

  it('applies relation quality filters before traversal', async () => {
    const response = await app!.inject({
      method: 'GET',
      url: pathUrl(
        eventIds.a,
        eventIds.c,
        '&minConfidence=50&minCaseCount=1&maxDepth=5&pathLimit=10',
      ),
    });
    const body = causalPathResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body.paths.map((path) => path.relations.map((relation) => relation.id))).toEqual([
      [relationIds.ab, relationIds.bc],
    ]);

    const excluded = await app!.inject({
      method: 'GET',
      url: pathUrl(eventIds.a, eventIds.c, '&minConfidence=75&minCaseCount=1'),
    });
    expect(causalPathResponseSchema.parse(excluded.json()).paths).toEqual([]);
  });

  it('does not infer a reverse path and returns an empty successful response', async () => {
    const response = await app!.inject({
      method: 'GET',
      url: pathUrl(eventIds.c, eventIds.a),
    });
    const body = causalPathResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body.paths).toEqual([]);
    expect(body.truncated).toBe(false);
  });

  it('returns 404 for a missing endpoint and 400 for identical endpoints', async () => {
    const missingId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const missing = await app!.inject({
      method: 'GET',
      url: pathUrl(eventIds.a, missingId),
    });
    const identical = await app!.inject({
      method: 'GET',
      url: pathUrl(eventIds.a, eventIds.a),
    });

    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({
      code: 'EVENT_NOT_FOUND',
      message: '终点事件不存在',
    });
    expect(identical.statusCode).toBe(400);
    expect(identical.json()).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '请求参数不合法',
    });
  });

  it('publishes the read-only path endpoint in OpenAPI', async () => {
    const document = (
      await app!.inject({
        method: 'GET',
        url: '/api/openapi.json',
      })
    ).json<{ paths: Record<string, Record<string, unknown>> }>();

    expect(document.paths['/api/causal-paths']).toHaveProperty('get');
    expect(document.paths['/api/causal-paths']).not.toHaveProperty('post');
  });

  it('builds a continuous evidence bundle with limited relation cases', async () => {
    await pool!.query('insert into concrete_cases (id, content) values ($1, $2)', [
      caseIds.abSecond,
      '事件 A 后再次观察到事件 B',
    ]);
    await pool!.query(
      'insert into causal_relation_cases (causal_relation_id, concrete_case_id) values ($1, $2)',
      [relationIds.ab, caseIds.abSecond],
    );
    const response = await app!.inject({
      method: 'POST',
      url: '/api/causal-evidence-bundles',
      payload: {
        relationIds: [relationIds.ab, relationIds.bc],
        caseLimitPerRelation: 1,
      },
    });
    const body = causalEvidenceBundleResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body.events.map((event) => event.id)).toEqual([eventIds.a, eventIds.b, eventIds.c]);
    expect(body).toMatchObject({
      hopCount: 2,
      minimumConfidence: 70,
      totalCaseCount: 3,
      relations: [
        {
          id: relationIds.ab,
          caseCount: 2,
          returnedCaseCount: 1,
          casesTruncated: true,
          evidenceStatus: 'supported',
        },
        {
          id: relationIds.bc,
          caseCount: 1,
          returnedCaseCount: 1,
          casesTruncated: false,
          evidenceStatus: 'supported',
        },
      ],
    });
  });

  it('marks a relation without cases instead of claiming evidence', async () => {
    const response = await app!.inject({
      method: 'POST',
      url: '/api/causal-evidence-bundles',
      payload: { relationIds: [relationIds.ac] },
    });
    const body = causalEvidenceBundleResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body.relations[0]).toMatchObject({
      id: relationIds.ac,
      caseCount: 0,
      cases: [],
      evidenceStatus: 'no_cases',
    });
  });

  it('returns structured missing, invalid-order, and cycle errors', async () => {
    const missingId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const missing = await app!.inject({
      method: 'POST',
      url: '/api/causal-evidence-bundles',
      payload: { relationIds: [missingId] },
    });
    const invalidOrder = await app!.inject({
      method: 'POST',
      url: '/api/causal-evidence-bundles',
      payload: { relationIds: [relationIds.bc, relationIds.ab] },
    });
    const cycle = await app!.inject({
      method: 'POST',
      url: '/api/causal-evidence-bundles',
      payload: { relationIds: [relationIds.bc, relationIds.cb] },
    });

    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({
      code: 'EVIDENCE_RELATION_NOT_FOUND',
      message: '证据包中的因果关系不存在',
      fields: { 'relationIds.0': '重新查询路径并使用当前存在的关系' },
    });
    expect(invalidOrder.statusCode).toBe(409);
    expect(invalidOrder.json()).toEqual({
      code: 'EVIDENCE_PATH_INVALID',
      message: '证据包关系顺序不连续或路径数据已变化',
      fields: { 'relationIds.1': '重新查询路径或调整关系顺序' },
    });
    expect(cycle.statusCode).toBe(409);
    expect(cycle.json()).toEqual({
      code: 'EVIDENCE_PATH_CYCLE',
      message: '证据包路径形成循环',
      fields: { 'relationIds.1': '移除导致循环的关系并重新查询路径' },
    });
  });

  it('publishes only POST for the evidence bundle endpoint', async () => {
    const document = (
      await app!.inject({
        method: 'GET',
        url: '/api/openapi.json',
      })
    ).json<{ paths: Record<string, Record<string, unknown>> }>();

    expect(document.paths['/api/causal-evidence-bundles']).toHaveProperty('post');
    expect(document.paths['/api/causal-evidence-bundles']).not.toHaveProperty('get');
  });

  it('bounds a real three-hop branching query and leaves all business tables unchanged', async () => {
    await pool!.query(
      [
        'insert into abstract_events (id, name) values',
        "($1, '第一层事件 A'), ($2, '第一层事件 B'),",
        "($3, '第二层事件 A'), ($4, '第二层事件 B'), ($5, '分支目标事件')",
      ].join(' '),
      [...branchEventIds],
    );
    await pool!.query(
      [
        'insert into causal_relations (',
        'id, cause_event_id, effect_event_id, confidence, baseline_confidence, baseline_case_count',
        ') values',
        '($1, $9, $10, 60, 60, 0), ($2, $9, $11, 60, 60, 0),',
        '($3, $10, $12, 60, 60, 0), ($4, $10, $13, 60, 60, 0),',
        '($5, $11, $12, 60, 60, 0), ($6, $11, $13, 60, 60, 0),',
        '($7, $12, $14, 60, 60, 0), ($8, $13, $14, 60, 60, 0)',
      ].join(' '),
      [
        ...branchRelationIds,
        eventIds.d,
        branchEventIds[0],
        branchEventIds[1],
        branchEventIds[2],
        branchEventIds[3],
        branchEventIds[4],
      ],
    );
    const before = await businessTableFingerprint(pool!);

    const pathResponse = await app!.inject({
      method: 'GET',
      url: pathUrl(eventIds.d, branchEventIds[4], '&maxDepth=3&pathLimit=10'),
    });
    const paths = causalPathResponseSchema.parse(pathResponse.json());
    expect(pathResponse.statusCode).toBe(200);
    expect(paths.paths).toHaveLength(4);
    expect(paths.paths.length).toBeLessThanOrEqual(10);
    expect(paths.expandedStateCount).toBeLessThanOrEqual(10_000);
    expect(paths.paths.every((path) => path.hopCount === 3)).toBe(true);

    const evidenceResponse = await app!.inject({
      method: 'POST',
      url: '/api/causal-evidence-bundles',
      payload: {
        relationIds: paths.paths[0]!.relations.map((relation) => relation.id),
        caseLimitPerRelation: 5,
      },
    });
    expect(evidenceResponse.statusCode).toBe(200);
    expect(causalEvidenceBundleResponseSchema.parse(evidenceResponse.json()).hopCount).toBe(3);

    const after = await businessTableFingerprint(pool!);
    expect(after).toEqual(before);
  });
});
