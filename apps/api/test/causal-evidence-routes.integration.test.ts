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

function pathUrl(sourceEventId: string, targetEventId: string, suffix = ''): string {
  return (
    '/api/causal-paths?sourceEventId=' + sourceEventId + '&targetEventId=' + targetEventId + suffix
  );
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
});
