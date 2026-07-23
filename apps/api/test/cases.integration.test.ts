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

    const targetId = secondPage.items[0]!.id;
    const target = (
      await app!.inject({ method: 'GET', url: `/api/cases/${targetId}` })
    ).json<CaseDetail>();
    const locatedPage = (
      await app!.inject({ method: 'GET', url: `/api/cases?page=${target.listPage}` })
    ).json<CaseListResponse>();
    expect(locatedPage.items.some((item) => item.id === targetId)).toBe(true);

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
    const createdIds: string[] = [];
    for (const index of [1, 2, 3, 4, 5]) {
      const created = (await createCase(`CASEPAGE 候选案例 ${index}`)).json<CaseDetail>();
      createdIds.push(created.id);
    }
    await pool!.query(
      `update concrete_cases
       set updated_at = '2026-07-23T08:00:00.123456Z'::timestamptz
       where id = any($1::uuid[])`,
      [createdIds],
    );
    const expectedOrder = [...createdIds].sort((left, right) => right.localeCompare(left));

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
    const third = await app!.inject({
      method: 'GET',
      url: `/api/cases/candidates?q=CASEPAGE&limit=2&cursor=${encodeURIComponent(secondPage.nextCursor!)}`,
    });
    const thirdPage = third.json<CaseCandidateListResponse>();

    expect([first.statusCode, second.statusCode, third.statusCode]).toEqual([200, 200, 200]);
    expect(firstPage).toMatchObject({ hasMore: true });
    expect(secondPage).toMatchObject({ hasMore: true });
    expect(thirdPage).toMatchObject({ hasMore: false, nextCursor: null });
    expect(
      [...firstPage.items, ...secondPage.items, ...thirdPage.items].map((item) => item.id),
    ).toEqual(expectedOrder);

    const mismatch = await app!.inject({
      method: 'GET',
      url: `/api/cases/candidates?q=OTHER&limit=2&cursor=${encodeURIComponent(firstPage.nextCursor!)}`,
    });
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('paginates a case relation list without losing equal microsecond timestamps', async () => {
    const linkedCase = (await createCase('2026年案例详情高精度游标测试')).json<CaseDetail>();
    const eventIds = [
      '11000000-0000-4000-8000-000000000001',
      '11000000-0000-4000-8000-000000000002',
      '11000000-0000-4000-8000-000000000003',
      '11000000-0000-4000-8000-000000000004',
    ];
    const relationIds = [
      '21000000-0000-4000-8000-000000000001',
      '21000000-0000-4000-8000-000000000002',
      '21000000-0000-4000-8000-000000000003',
    ];
    await pool!.query(
      `insert into abstract_events (id, name)
       values ($1, '高精度原因'), ($2, '高精度结果一'), ($3, '高精度结果二'), ($4, '高精度结果三')`,
      eventIds,
    );
    await pool!.query(
      `insert into causal_relations (id, cause_event_id, effect_event_id, confidence)
       values ($1, $4, $5, 10), ($2, $4, $6, 20), ($3, $4, $7, 30)`,
      [...relationIds, eventIds[0], eventIds[1], eventIds[2], eventIds[3]],
    );
    await pool!.query(
      `insert into causal_relation_cases (causal_relation_id, concrete_case_id, linked_at)
       select relation_id, $2, '2026-07-23T08:00:00.123456Z'::timestamptz
       from unnest($1::uuid[]) as linked(relation_id)`,
      [relationIds, linkedCase.id],
    );

    const expectedOrder = [...relationIds].sort((left, right) => right.localeCompare(left));
    const first = await app!.inject({
      method: 'GET',
      url: `/api/cases/${linkedCase.id}/relations?limit=2`,
    });
    const firstPage = first.json<CaseRelationListResponse>();
    const second = await app!.inject({
      method: 'GET',
      url: `/api/cases/${linkedCase.id}/relations?limit=2&cursor=${encodeURIComponent(firstPage.nextCursor!)}`,
    });
    const secondPage = second.json<CaseRelationListResponse>();

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect([...firstPage.items, ...secondPage.items].map((item) => item.id)).toEqual(expectedOrder);
    expect(firstPage.items.map((item) => item.linkedAt)).toEqual([
      '2026-07-23T08:00:00.123Z',
      '2026-07-23T08:00:00.123Z',
    ]);
    expect(secondPage).toMatchObject({ hasMore: false, nextCursor: null });
  });

  it('filters orphan cases inside search totals and pagination', async () => {
    const orphanOne = (await createCase('CASE_ORPHAN_TOKEN 独立案例一')).json<CaseDetail>();
    const orphanTwo = (await createCase('CASE_ORPHAN_TOKEN 独立案例二')).json<CaseDetail>();
    const linked = (await createCase('CASE_ORPHAN_TOKEN 已关联案例')).json<CaseDetail>();
    const causeId = '14000000-0000-4000-8000-000000000001';
    const effectId = '14000000-0000-4000-8000-000000000002';
    const relationId = '24000000-0000-4000-8000-000000000001';
    await pool!.query(
      `insert into abstract_events (id, name)
       values ($1, '案例孤立筛选原因'), ($2, '案例孤立筛选结果')`,
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
      [relationId, linked.id],
    );

    const response = (
      await app!.inject({
        method: 'GET',
        url: '/api/cases?orphan=true&q=CASE_ORPHAN_TOKEN&page=99&limit=1',
      })
    ).json<CaseListResponse>();
    expect(response).toMatchObject({ page: 2, pageSize: 1, totalItems: 2, totalPages: 2 });
    expect([orphanOne.id, orphanTwo.id]).toContain(response.items[0]?.id);
    expect(response.items[0]?.id).not.toBe(linked.id);
  });

  it('deletes a case and its links while preserving relations and check state', async () => {
    const linkedCase = (await createCase('2026年删除案例仍保留关系')).json<CaseDetail>();
    const causeId = '15000000-0000-4000-8000-000000000001';
    const effectId = '15000000-0000-4000-8000-000000000002';
    const relationId = '25000000-0000-4000-8000-000000000001';
    await pool!.query(
      `insert into abstract_events (id, name)
       values ($1, '删除案例保留原因'), ($2, '删除案例保留结果')`,
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
    const stateBefore = await pool!.query<{ state: string }>(
      `select row_to_json(data_check_state)::text as state from data_check_state`,
    );

    const impact = await app!.inject({
      method: 'GET',
      url: `/api/cases/${linkedCase.id}/deletion-impact`,
    });
    expect(impact.statusCode).toBe(200);
    expect(impact.json()).toEqual({ canDelete: true, hasRelations: true });

    const removed = await app!.inject({
      method: 'DELETE',
      url: `/api/cases/${linkedCase.id}`,
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toEqual({ deleted: true });
    expect(
      (await app!.inject({ method: 'GET', url: `/api/cases/${linkedCase.id}` })).statusCode,
    ).toBe(404);
    expect(
      (await app!.inject({ method: 'GET', url: `/api/relations/${relationId}` })).statusCode,
    ).toBe(200);
    const links = await pool!.query<{ count: string }>(
      `select count(*) from causal_relation_cases where concrete_case_id = $1`,
      [linkedCase.id],
    );
    expect(links.rows[0]?.count).toBe('0');
    const stateAfter = await pool!.query<{ state: string }>(
      `select row_to_json(data_check_state)::text as state from data_check_state`,
    );
    expect(stateAfter.rows[0]?.state).toBe(stateBefore.rows[0]?.state);
  });

  it('returns stable client errors and publishes case paths', async () => {
    const missing = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    expect((await app!.inject({ method: 'GET', url: `/api/cases/${missing}` })).statusCode).toBe(
      404,
    );
    expect(
      (
        await app!.inject({
          method: 'GET',
          url: `/api/cases/${missing}/deletion-impact`,
        })
      ).statusCode,
    ).toBe(404);
    expect((await app!.inject({ method: 'DELETE', url: `/api/cases/${missing}` })).statusCode).toBe(
      404,
    );
    const openapi = await app!.inject({ method: 'GET', url: '/api/openapi.json' });
    const paths = openapi.json<{ paths: Record<string, unknown> }>().paths;
    expect(paths).toHaveProperty('/api/cases');
    expect(paths).toHaveProperty('/api/cases/candidates');
    expect(paths).toHaveProperty('/api/cases/{caseId}');
    expect(paths).toHaveProperty('/api/cases/{caseId}/relations');
    expect(paths).toHaveProperty('/api/cases/{caseId}/deletion-impact');
  });
});
