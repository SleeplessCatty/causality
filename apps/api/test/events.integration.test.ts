import type {
  EventCandidateListResponse,
  EventDetail,
  EventListResponse,
  EventRelationListResponse,
} from '@causality/contracts';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { buildApp } from '../src/app.js';
import { startPostgresTestContext } from './support/postgresTestContext.js';

describe.sequential('event REST API', () => {
  let context: Awaited<ReturnType<typeof startPostgresTestContext>> | undefined;
  let app: ReturnType<typeof buildApp> | undefined;
  let pool: Pool | undefined;

  beforeAll(async () => {
    context = await startPostgresTestContext('causality_events_test');
    ({ app, pool } = context);
  }, 120_000);

  afterAll(async () => {
    await context?.close();
  });

  async function createEvent(
    name: string,
    overrides: Partial<{
      description: string | null;
      aliases: string[];
      keywords: string[];
    }> = {},
  ) {
    return app!.inject({
      method: 'POST',
      url: '/api/events',
      payload: {
        name,
        description: overrides.description ?? null,
        aliases: overrides.aliases ?? [],
        keywords: overrides.keywords ?? [],
      },
    });
  }

  it('creates an event with aliases and returns its detail', async () => {
    const response = await createEvent('测试：大宗商品价格上升', {
      description: '大宗商品综合价格持续上行',
      aliases: ['商品价格上涨', 'Commodity Rise'],
      keywords: ['大宗商品', '通胀'],
    });
    const created = response.json<EventDetail>();

    expect(response.statusCode).toBe(201);
    expect(created).toMatchObject({
      name: '测试：大宗商品价格上升',
      description: '大宗商品综合价格持续上行',
      aliases: ['商品价格上涨', 'Commodity Rise'],
      keywords: ['大宗商品', '通胀'],
    });

    const detail = await app!.inject({ method: 'GET', url: `/api/events/${created.id}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toEqual(created);

    const list = await app!.inject({
      method: 'GET',
      url: `/api/events?q=${encodeURIComponent(created.name)}&limit=5`,
    });
    expect(list.json<EventListResponse>().items[0]?.keywords).toEqual(['大宗商品', '通胀']);
  });

  it('enforces 50/80/50 character event field boundaries', async () => {
    const accepted = await createEvent('事'.repeat(50), {
      aliases: ['别'.repeat(80)],
      keywords: ['词'.repeat(50)],
    });
    expect(accepted.statusCode).toBe(201);
    expect((await createEvent('事'.repeat(51))).statusCode).toBe(400);
    expect((await createEvent('测试：别名边界', { aliases: ['别'.repeat(81)] })).statusCode).toBe(
      400,
    );
    expect(
      (await createEvent('测试：关键词边界', { keywords: ['词'.repeat(51)] })).statusCode,
    ).toBe(400);
  });

  it('rejects normalized duplicate names with a stable conflict response', async () => {
    await createEvent('测试：政策预期转鹰');
    const duplicate = await createEvent('  测试：政策预期转鹰  ');

    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toEqual({
      code: 'EVENT_NAME_CONFLICT',
      message: '该标准名称已被使用',
      fields: { name: '该标准名称已被使用' },
    });
  });

  it('allows different events to share an alias', async () => {
    const first = await createEvent('测试：能源供给减少', { aliases: ['供给收紧'] });
    const second = await createEvent('测试：资金供给减少', { aliases: ['供给收紧'] });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
  });

  it('fully replaces editable fields and rolls back a conflicting update', async () => {
    const target = (
      await createEvent('测试：旧事件名称', { aliases: ['旧别名'] })
    ).json<EventDetail>();
    const other = (await createEvent('测试：不可占用名称')).json<EventDetail>();

    const updatedResponse = await app!.inject({
      method: 'PUT',
      url: `/api/events/${target.id}`,
      payload: {
        name: '测试：新事件名称',
        description: '更新后的说明',
        aliases: ['新别名一', '新别名二'],
        keywords: ['更新', '测试'],
      },
    });
    const updated = updatedResponse.json<EventDetail>();
    expect(updatedResponse.statusCode).toBe(200);
    expect(updated).toMatchObject({
      name: '测试：新事件名称',
      keywords: ['更新', '测试'],
    });
    expect(updated.aliases).toHaveLength(2);
    expect(updated.aliases).toEqual(expect.arrayContaining(['新别名一', '新别名二']));
    const updatedDetail = await app!.inject({ method: 'GET', url: `/api/events/${target.id}` });
    expect(updatedDetail.json<EventDetail>().keywords).toEqual(['更新', '测试']);
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(target.updatedAt).getTime(),
    );

    const conflict = await app!.inject({
      method: 'PUT',
      url: `/api/events/${target.id}`,
      payload: {
        name: other.name,
        description: null,
        aliases: ['不应保存'],
        keywords: [],
      },
    });
    expect(conflict.statusCode).toBe(409);

    const afterConflict = await app!.inject({ method: 'GET', url: `/api/events/${target.id}` });
    expect(afterConflict.json<EventDetail>()).toMatchObject({
      name: '测试：新事件名称',
    });
    expect(afterConflict.json<EventDetail>().aliases).toEqual(
      expect.arrayContaining(['新别名一', '新别名二']),
    );
  });

  it('returns not found for missing detail and update targets', async () => {
    const missingId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const detail = await app!.inject({ method: 'GET', url: `/api/events/${missingId}` });
    const relations = await app!.inject({
      method: 'GET',
      url: `/api/events/${missingId}/relations`,
    });
    const update = await app!.inject({
      method: 'PUT',
      url: `/api/events/${missingId}`,
      payload: { name: '测试：不存在', description: null, aliases: [], keywords: [] },
    });

    expect(detail.statusCode).toBe(404);
    expect(relations.statusCode).toBe(404);
    expect(update.statusCode).toBe(404);
    expect(detail.json()).toMatchObject({ code: 'EVENT_NOT_FOUND' });
  });

  it('lists both upstream and downstream relations with stable linked-time cursors', async () => {
    const upstream = (await createEvent('测试：事件关系上游')).json<EventDetail>();
    const center = (await createEvent('测试：事件关系中心')).json<EventDetail>();
    const downstream = (await createEvent('测试：事件关系下游')).json<EventDetail>();
    const upstreamRelation = await app!.inject({
      method: 'POST',
      url: '/api/relations',
      payload: {
        causeEventId: upstream.id,
        effectEventId: center.id,
        confidence: 50,
        description: null,
        caseSelections: [],
      },
    });
    const downstreamRelation = await app!.inject({
      method: 'POST',
      url: '/api/relations',
      payload: {
        causeEventId: center.id,
        effectEventId: downstream.id,
        confidence: 50,
        description: null,
        caseSelections: [],
      },
    });
    expect(upstreamRelation.statusCode).toBe(201);
    expect(downstreamRelation.statusCode).toBe(201);
    const relationIds = [
      upstreamRelation.json<{ id: string }>().id,
      downstreamRelation.json<{ id: string }>().id,
    ];
    await pool!.query(
      `update causal_relations
       set created_at = '2026-07-23T08:00:00.123456Z'::timestamptz
       where id = any($1::uuid[])`,
      [relationIds],
    );

    const detail = await app!.inject({ method: 'GET', url: `/api/events/${center.id}` });
    expect(detail.json<EventDetail>().relationCount).toBe(2);
    const first = await app!.inject({
      method: 'GET',
      url: `/api/events/${center.id}/relations?limit=1`,
    });
    const firstPage = first.json<EventRelationListResponse>();
    const second = await app!.inject({
      method: 'GET',
      url: `/api/events/${center.id}/relations?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor!)}`,
    });
    const secondPage = second.json<EventRelationListResponse>();
    const items = [...firstPage.items, ...secondPage.items];

    expect(first.statusCode).toBe(200);
    expect(firstPage).toMatchObject({ hasMore: true });
    expect(second.statusCode).toBe(200);
    expect(secondPage).toMatchObject({ hasMore: false, nextCursor: null });
    expect(items).toHaveLength(2);
    expect(items.every((item) => item.linkedAt === '2026-07-23T08:00:00.123Z')).toBe(true);
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          causeEvent: expect.objectContaining({ id: upstream.id }),
          effectEvent: expect.objectContaining({ id: center.id }),
        }),
        expect.objectContaining({
          causeEvent: expect.objectContaining({ id: center.id }),
          effectEvent: expect.objectContaining({ id: downstream.id }),
        }),
      ]),
    );

    const mismatch = await app!.inject({
      method: 'GET',
      url: `/api/events/${downstream.id}/relations?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor!)}`,
    });
    expect(mismatch.statusCode).toBe(400);
  });

  it('returns numbered pages, matching totals, and clamps an out-of-range page', async () => {
    for (let index = 1; index <= 31; index += 1) {
      await createEvent(`EVENT_PAGE_TOKEN 事件 ${String(index).padStart(2, '0')}`);
    }
    await createEvent('测试：页码计数无关事件');

    const first = await app!.inject({
      method: 'GET',
      url: '/api/events?q=EVENT_PAGE_TOKEN&page=1&limit=30',
    });
    const firstPage = first.json<EventListResponse>();
    const second = await app!.inject({
      method: 'GET',
      url: '/api/events?q=EVENT_PAGE_TOKEN&page=2&limit=30',
    });
    const secondPage = second.json<EventListResponse>();
    const clamped = (
      await app!.inject({
        method: 'GET',
        url: '/api/events?q=EVENT_PAGE_TOKEN&page=999&limit=30',
      })
    ).json<EventListResponse>();

    expect(first.statusCode).toBe(200);
    expect(firstPage).toMatchObject({ page: 1, pageSize: 30, totalItems: 31, totalPages: 2 });
    expect(firstPage.items).toHaveLength(30);
    expect(second.statusCode).toBe(200);
    expect(secondPage).toMatchObject({ page: 2, pageSize: 30, totalItems: 31, totalPages: 2 });
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items.map((event) => event.id)).not.toEqual(
      expect.arrayContaining(firstPage.items.map((event) => event.id)),
    );
    expect(clamped).toMatchObject({ page: 2, pageSize: 30, totalItems: 31, totalPages: 2 });
    expect(clamped.items).toHaveLength(1);

    const targetId = secondPage.items[0]!.id;
    const target = (
      await app!.inject({ method: 'GET', url: `/api/events/${targetId}` })
    ).json<EventDetail>();
    const locatedPage = (
      await app!.inject({ method: 'GET', url: `/api/events?page=${target.listPage}` })
    ).json<EventListResponse>();
    expect(locatedPage.items.some((item) => item.id === targetId)).toBe(true);
  });

  it('searches names, aliases, and keywords with stable ranking', async () => {
    await createEvent('SEARCHTOKEN 标准名称', { aliases: ['其他别名'] });
    await createEvent('测试：包含 SEARCHTOKEN 的名称');
    await createEvent('测试：别名命中项', { aliases: ['SEARCHTOKEN'] });
    await createEvent('测试：关键词命中项', { keywords: ['prefix-SEARCHTOKEN-suffix'] });

    const response = await app!.inject({
      method: 'GET',
      url: '/api/events?q=SEARCHTOKEN&limit=20',
    });
    const names = response.json<EventListResponse>().items.map((event) => event.name);

    expect(response.statusCode).toBe(200);
    expect(names).toEqual(
      expect.arrayContaining([
        'SEARCHTOKEN 标准名称',
        '测试：包含 SEARCHTOKEN 的名称',
        '测试：别名命中项',
        '测试：关键词命中项',
      ]),
    );
    expect(names.indexOf('SEARCHTOKEN 标准名称')).toBeLessThan(names.indexOf('测试：别名命中项'));
  });

  it('returns minimal candidates and can exclude the current event', async () => {
    const current = (
      await createEvent('测试：候选原油价格上涨', { aliases: ['候选油价上涨'] })
    ).json<EventDetail>();
    await createEvent('测试：候选能源价格上涨', { keywords: ['候选油价上涨'] });

    const response = await app!.inject({
      method: 'GET',
      url: `/api/events/candidates?q=${encodeURIComponent('候选油价上涨')}&limit=5&excludeId=${current.id}`,
    });
    const body = response.json<EventCandidateListResponse>();

    expect(response.statusCode).toBe(200);
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((item) => Object.keys(item).sort().join(',') === 'id,name')).toBe(true);
    expect(body.items.some((item) => item.id === current.id)).toBe(false);
  });

  it('paginates candidates without duplicates and rejects mismatched cursors', async () => {
    for (const index of [1, 2, 3, 4, 5]) {
      await createEvent(`CANDIDATEPAGE 事件 ${index}`);
    }

    const first = await app!.inject({
      method: 'GET',
      url: '/api/events/candidates?q=CANDIDATEPAGE&limit=2',
    });
    const firstPage = first.json<EventCandidateListResponse>();
    const second = await app!.inject({
      method: 'GET',
      url: `/api/events/candidates?q=CANDIDATEPAGE&limit=2&cursor=${encodeURIComponent(firstPage.nextCursor!)}`,
    });
    const secondPage = second.json<EventCandidateListResponse>();

    expect(first.statusCode).toBe(200);
    expect(firstPage).toMatchObject({ hasMore: true });
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(second.statusCode).toBe(200);
    expect(secondPage.items.map((item) => item.id)).not.toEqual(
      expect.arrayContaining(firstPage.items.map((item) => item.id)),
    );

    const mismatch = await app!.inject({
      method: 'GET',
      url: `/api/events/candidates?q=OTHER&limit=2&cursor=${encodeURIComponent(firstPage.nextCursor!)}`,
    });
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('deletes only unlinked events and preserves the saved data-check state', async () => {
    const created = (
      await createEvent('测试：可安全删除原子事件', {
        aliases: ['测试：待删除别名'],
        keywords: ['待删除关键词'],
      })
    ).json<EventDetail>();
    await pool!.query(
      `update data_check_state
       set status = 'succeeded',
           last_snapshot_id = 'a1000000-0000-4000-8000-000000000001',
           last_success_at = '2026-07-23T09:00:00Z',
           orphan_event_count = 9`,
    );
    const stateBefore = await pool!.query<{ state: string }>(
      `select row_to_json(data_check_state)::text as state from data_check_state`,
    );

    const impact = await app!.inject({
      method: 'GET',
      url: `/api/events/${created.id}/deletion-impact`,
    });
    expect(impact.statusCode).toBe(200);
    expect(impact.json()).toEqual({ canDelete: true, hasRelations: false });

    const removed = await app!.inject({ method: 'DELETE', url: `/api/events/${created.id}` });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toEqual({ deleted: true });
    expect(
      (await app!.inject({ method: 'GET', url: `/api/events/${created.id}` })).statusCode,
    ).toBe(404);
    const children = await pool!.query<{ aliases: string; keywords: string }>(
      `select
         (select count(*) from event_aliases where event_id = $1) as aliases,
         (select count(*) from event_keywords where event_id = $1) as keywords`,
      [created.id],
    );
    expect(children.rows[0]).toEqual({ aliases: '0', keywords: '0' });
    const stateAfter = await pool!.query<{ state: string }>(
      `select row_to_json(data_check_state)::text as state from data_check_state`,
    );
    expect(stateAfter.rows[0]?.state).toBe(stateBefore.rows[0]?.state);
  });

  it('blocks event deletion when a relation exists, including one added after impact', async () => {
    const cause = (await createEvent('测试：删除竞态原因')).json<EventDetail>();
    const effect = (await createEvent('测试：删除竞态结果')).json<EventDetail>();

    const beforeLink = await app!.inject({
      method: 'GET',
      url: `/api/events/${cause.id}/deletion-impact`,
    });
    expect(beforeLink.json()).toEqual({ canDelete: true, hasRelations: false });

    await app!.inject({
      method: 'POST',
      url: '/api/relations',
      payload: {
        causeEventId: cause.id,
        effectEventId: effect.id,
        confidence: 50,
        description: null,
        caseSelections: [],
      },
    });

    const afterLink = await app!.inject({
      method: 'GET',
      url: `/api/events/${cause.id}/deletion-impact`,
    });
    expect(afterLink.json()).toEqual({ canDelete: false, hasRelations: true });
    expect(Object.keys(afterLink.json())).toEqual(['canDelete', 'hasRelations']);

    const blocked = await app!.inject({ method: 'DELETE', url: `/api/events/${cause.id}` });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toEqual({
      code: 'EVENT_DELETE_BLOCKED',
      message: '这个原子事件存在关联因果关系，必须先删除相关因果关系',
    });
    expect((await app!.inject({ method: 'GET', url: `/api/events/${cause.id}` })).statusCode).toBe(
      200,
    );
  });

  it('returns only orphan events within search, totals, and page clamping', async () => {
    const orphanIds: string[] = [];
    for (let index = 1; index <= 31; index += 1) {
      orphanIds.push(
        (
          await createEvent(`EVENT_ORPHAN_TOKEN ${String(index).padStart(2, '0')}`)
        ).json<EventDetail>().id,
      );
    }
    const linkedEffect = (await createEvent('测试：孤立筛选关联结果')).json<EventDetail>();
    await app!.inject({
      method: 'POST',
      url: '/api/relations',
      payload: {
        causeEventId: orphanIds[0],
        effectEventId: linkedEffect.id,
        confidence: 50,
        description: null,
        caseSelections: [],
      },
    });

    const first = (
      await app!.inject({
        method: 'GET',
        url: '/api/events?orphan=true&q=EVENT_ORPHAN_TOKEN&page=1&limit=20',
      })
    ).json<EventListResponse>();
    const clamped = (
      await app!.inject({
        method: 'GET',
        url: '/api/events?orphan=true&q=EVENT_ORPHAN_TOKEN&page=999&limit=20',
      })
    ).json<EventListResponse>();

    expect(first).toMatchObject({ page: 1, pageSize: 20, totalItems: 30, totalPages: 2 });
    expect(first.items).toHaveLength(20);
    expect(first.items.some((item) => item.id === orphanIds[0])).toBe(false);
    expect(clamped).toMatchObject({ page: 2, pageSize: 20, totalItems: 30, totalPages: 2 });
    expect(clamped.items).toHaveLength(10);
  });

  it('returns not found from both event deletion endpoints', async () => {
    const missingId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    expect(
      (
        await app!.inject({
          method: 'GET',
          url: `/api/events/${missingId}/deletion-impact`,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await app!.inject({ method: 'DELETE', url: `/api/events/${missingId}` })).statusCode,
    ).toBe(404);
  });

  it('publishes event paths in OpenAPI', async () => {
    const response = await app!.inject({ method: 'GET', url: '/api/openapi.json' });
    const paths = response.json<{ paths: Record<string, unknown> }>().paths;

    expect(paths).toHaveProperty('/api/events');
    expect(paths).toHaveProperty('/api/events/candidates');
    expect(paths).toHaveProperty('/api/events/{eventId}');
    expect(paths).toHaveProperty('/api/events/{eventId}/relations');
    expect(paths).toHaveProperty('/api/events/{eventId}/deletion-impact');
  });
});
