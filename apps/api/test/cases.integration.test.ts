import type {
  CaseCandidateListResponse,
  CaseDetail,
  CaseListResponse,
  CaseRelationListResponse,
} from '@causality/contracts';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { buildApp } from '../src/app.js';
import { startPostgresTestContext } from './support/postgresTestContext.js';

describe.sequential('case REST API', () => {
  let context: Awaited<ReturnType<typeof startPostgresTestContext>> | undefined;
  let pool: Pool | undefined;
  let app: ReturnType<typeof buildApp> | undefined;

  beforeAll(async () => {
    context = await startPostgresTestContext('causality_cases_test');
    ({ pool, app } = context);
  }, 120_000);

  afterAll(async () => {
    await context?.close();
  });

  async function createCase(content: string) {
    return app!.inject({ method: 'POST', url: '/api/cases', payload: { content } });
  }

  it('creates, reads, replaces, and rejects duplicate case content', async () => {
    const createdResponse = await createCase('2025年4月美国宣布新一轮关税措施');
    const created = createdResponse.json<CaseDetail>();
    expect(createdResponse.statusCode).toBe(201);
    expect(created).toMatchObject({ content: '2025年4月美国宣布新一轮关税措施', relationCount: 0 });

    const detail = await app!.inject({ method: 'GET', url: `/api/cases/${created.id}` });
    expect(detail.json()).toEqual(created);

    const replaced = await app!.inject({
      method: 'PUT',
      url: `/api/cases/${created.id}`,
      payload: { content: '2025年4月美国正式实施新一轮关税措施' },
    });
    expect(replaced.statusCode).toBe(200);
    expect(replaced.json()).toMatchObject({ content: '2025年4月美国正式实施新一轮关税措施' });

    const duplicate = await createCase('2025年4月美国正式实施新一轮关税措施');
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({
      code: 'CASE_CONTENT_CONFLICT',
      existingId: created.id,
    });
  });

  it('accepts 100-character cases and rejects 101 characters', async () => {
    expect((await createCase('例'.repeat(100))).statusCode).toBe(201);
    expect((await createCase('例'.repeat(101))).statusCode).toBe(400);
  });

  it('returns numbered pages, matching totals, clamps an out-of-range page, and keeps candidates minimal', async () => {
    for (let index = 1; index <= 31; index += 1) {
      await createCase(`CASE_PAGE_TOKEN 案例 ${String(index).padStart(2, '0')}`);
    }
    await createCase('测试：页码计数无关案例');
    const first = await app!.inject({
      method: 'GET',
      url: '/api/cases?q=CASE_PAGE_TOKEN&page=1&limit=30',
    });
    const firstPage = first.json<CaseListResponse>();
    const second = await app!.inject({
      method: 'GET',
      url: '/api/cases?q=CASE_PAGE_TOKEN&page=2&limit=30',
    });
    const secondPage = second.json<CaseListResponse>();
    const clamped = (
      await app!.inject({
        method: 'GET',
        url: '/api/cases?q=CASE_PAGE_TOKEN&page=999&limit=30',
      })
    ).json<CaseListResponse>();
    expect(first.statusCode).toBe(200);
    expect(firstPage).toMatchObject({ page: 1, pageSize: 30, totalItems: 31, totalPages: 2 });
    expect(firstPage.items).toHaveLength(30);
    expect(secondPage).toMatchObject({ page: 2, pageSize: 30, totalItems: 31, totalPages: 2 });
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items.map((item) => item.id)).not.toEqual(
      expect.arrayContaining(firstPage.items.map((item) => item.id)),
    );
    expect(clamped).toMatchObject({ page: 2, pageSize: 30, totalItems: 31, totalPages: 2 });
    expect(clamped.items).toHaveLength(1);

    const candidates = await app!.inject({
      method: 'GET',
      url: '/api/cases/candidates?q=CASE_PAGE_TOKEN&limit=10',
    });
    const items = candidates.json<{ items: Array<Record<string, unknown>> }>().items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => Object.keys(item).sort().join(',') === 'content,id')).toBe(true);
  });

  it('filters cases by relation and paginates a case relation list', async () => {
    const linkedCase = (await createCase('2026年测试关系关联案例')).json<CaseDetail>();
    const causeId = '10000000-0000-4000-8000-000000000001';
    const effectId = '10000000-0000-4000-8000-000000000002';
    const relationId = '20000000-0000-4000-8000-000000000001';
    await pool!.query(
      `insert into abstract_events (id, name) values ($1, '测试原因'), ($2, '测试结果')`,
      [causeId, effectId],
    );
    await pool!.query(
      `insert into causal_relations (id, cause_event_id, effect_event_id, confidence)
       values ($1, $2, $3, 50)`,
      [relationId, causeId, effectId],
    );
    await pool!.query(
      `insert into causal_relation_cases (causal_relation_id, concrete_case_id)
       values ($1, $2)`,
      [relationId, linkedCase.id],
    );

    const filtered = await app!.inject({
      method: 'GET',
      url: `/api/cases?relationId=${relationId}`,
    });
    expect(filtered.json<CaseListResponse>().items).toHaveLength(1);
    expect(filtered.json<CaseListResponse>()).toMatchObject({
      page: 1,
      pageSize: 50,
      totalItems: 1,
      totalPages: 1,
    });
    expect(filtered.json<CaseListResponse>().items[0]).toMatchObject({
      id: linkedCase.id,
      relationCount: 1,
    });

    const relations = await app!.inject({
      method: 'GET',
      url: `/api/cases/${linkedCase.id}/relations?limit=30`,
    });
    expect(relations.json<CaseRelationListResponse>().items[0]).toMatchObject({
      id: relationId,
      causeEvent: { name: '测试原因' },
      effectEvent: { name: '测试结果' },
    });
  });

  it('paginates candidate cases without duplicates and binds cursors to the query', async () => {
    for (const index of [1, 2, 3, 4, 5]) {
      await createCase(`CASEPAGE 候选案例 ${index}`);
    }

    const first = await app!.inject({
      method: 'GET',
      url: '/api/cases/candidates?q=CASEPAGE&limit=2',
    });
    const firstPage = first.json<CaseCandidateListResponse>();
    const second = await app!.inject({
      method: 'GET',
      url: `/api/cases/candidates?q=CASEPAGE&limit=2&cursor=${encodeURIComponent(firstPage.nextCursor!)}`,
    });
    const secondPage = second.json<CaseCandidateListResponse>();

    expect(first.statusCode).toBe(200);
    expect(firstPage).toMatchObject({ hasMore: true });
    expect(secondPage.items.map((item) => item.id)).not.toEqual(
      expect.arrayContaining(firstPage.items.map((item) => item.id)),
    );

    const mismatch = await app!.inject({
      method: 'GET',
      url: `/api/cases/candidates?q=OTHER&limit=2&cursor=${encodeURIComponent(firstPage.nextCursor!)}`,
    });
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('returns stable client errors and publishes case paths', async () => {
    const missing = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    expect((await app!.inject({ method: 'GET', url: `/api/cases/${missing}` })).statusCode).toBe(
      404,
    );
    const openapi = await app!.inject({ method: 'GET', url: '/api/openapi.json' });
    const paths = openapi.json<{ paths: Record<string, unknown> }>().paths;
    expect(paths).toHaveProperty('/api/cases');
    expect(paths).toHaveProperty('/api/cases/candidates');
    expect(paths).toHaveProperty('/api/cases/{caseId}');
    expect(paths).toHaveProperty('/api/cases/{caseId}/relations');
  });
});
