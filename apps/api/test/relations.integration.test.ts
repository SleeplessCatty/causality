import type {
  CaseDetail,
  CaseSelection,
  EventDetail,
  RelationDetail,
  RelationListResponse,
} from '@causality/contracts';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { buildApp } from '../src/app.js';
import { startPostgresTestContext } from './support/postgresTestContext.js';

describe.sequential('relation REST API', () => {
  let context: Awaited<ReturnType<typeof startPostgresTestContext>> | undefined;
  let pool: Pool | undefined;
  let app: ReturnType<typeof buildApp> | undefined;
  let eventSequence = 0;

  beforeAll(async () => {
    context = await startPostgresTestContext('causality_relations_test');
    ({ pool, app } = context);
  }, 120_000);

  afterAll(async () => {
    await context?.close();
  });

  async function createEvent(name: string, aliases: string[] = []) {
    eventSequence += 1;
    const response = await app!.inject({
      method: 'POST',
      url: '/api/events',
      payload: {
        name: `${name}-${eventSequence}`,
        description: null,
        aliases,
        keywords: [],
      },
    });
    return response.json<EventDetail>();
  }

  async function createRelation(
    causeEventId: string,
    effectEventId: string,
    overrides: Partial<{
      confidence: number;
      description: string | null;
      caseSelections: CaseSelection[];
    }> = {},
  ) {
    return app!.inject({
      method: 'POST',
      url: '/api/relations',
      payload: {
        causeEventId,
        effectEventId,
        confidence: overrides.confidence ?? 70,
        description: overrides.description ?? null,
        caseSelections: overrides.caseSelections ?? [],
      },
    });
  }

  it('creates a directed relation and returns event references', async () => {
    const cause = await createEvent('测试：原油价格上涨');
    const effect = await createEvent('测试：航空成本上升');
    const response = await createRelation(cause.id, effect.id, {
      confidence: 82,
      description: '燃油成本传导',
    });
    const created = response.json<RelationDetail>();

    expect(response.statusCode).toBe(201);
    expect(created).toMatchObject({
      causeEvent: { id: cause.id, name: cause.name },
      effectEvent: { id: effect.id, name: effect.name },
      confidence: 82,
      caseCount: 0,
      description: '燃油成本传导',
      recentCases: [],
    });
    expect(
      (await app!.inject({ method: 'GET', url: `/api/relations/${created.id}` })).json(),
    ).toEqual(created);
  });

  it('reports same and reverse directions while allowing a reverse relation', async () => {
    const eventA = await createEvent('测试：融资成本上升');
    const eventB = await createEvent('测试：投资需求下降');
    const forward = (await createRelation(eventA.id, eventB.id)).json<RelationDetail>();

    const check = await app!.inject({
      method: 'GET',
      url: `/api/relations/pair-check?causeEventId=${eventB.id}&effectEventId=${eventA.id}`,
    });
    expect(check.json()).toMatchObject({
      sameDirection: null,
      reverseDirection: { id: forward.id },
    });
    expect((await createRelation(eventB.id, eventA.id)).statusCode).toBe(201);
  });

  it('rejects same-direction duplicates, self loops, and missing event references', async () => {
    const cause = await createEvent('测试：供给减少');
    const effect = await createEvent('测试：价格上涨');
    await createRelation(cause.id, effect.id);

    expect((await createRelation(cause.id, effect.id)).json()).toMatchObject({
      code: 'RELATION_DIRECTION_CONFLICT',
    });
    expect((await createRelation(cause.id, cause.id)).json()).toMatchObject({
      code: 'RELATION_SELF_LOOP',
    });
    expect(
      (await createRelation(cause.id, 'ffffffff-ffff-4fff-8fff-ffffffffffff')).json(),
    ).toMatchObject({ code: 'RELATION_EVENT_NOT_FOUND' });
  });

  it('replaces endpoints and editable fields', async () => {
    const cause = await createEvent('测试：美元走强');
    const oldEffect = await createEvent('测试：出口承压');
    const newEffect = await createEvent('测试：进口成本下降');
    const created = (await createRelation(cause.id, oldEffect.id)).json<RelationDetail>();
    const response = await app!.inject({
      method: 'PUT',
      url: `/api/relations/${created.id}`,
      payload: {
        causeEventId: cause.id,
        effectEventId: newEffect.id,
        confidence: 91,
        description: '汇率变化传导',
        caseSelections: [],
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      effectEvent: { id: newEffect.id },
      confidence: 91,
      description: '汇率变化传导',
    });
  });

  it('atomically creates, reuses, counts, limits, and unlinks concrete cases', async () => {
    const existingCase = (
      await app!.inject({
        method: 'POST',
        url: '/api/cases',
        payload: { content: '2026年关系测试已有案例' },
      })
    ).json<CaseDetail>();
    await pool!.query(`create table relation_case_batch_audit (inserted_count integer not null)`);
    await pool!.query(`
      create function audit_relation_case_batch() returns trigger as $$
      begin
        insert into relation_case_batch_audit (inserted_count)
        select count(*)::int from inserted_rows;
        return null;
      end;
      $$ language plpgsql
    `);
    await pool!.query(`
      create trigger audit_relation_case_batch_trigger
      after insert on concrete_cases
      referencing new table as inserted_rows
      for each statement execute function audit_relation_case_batch()
    `);
    try {
      const cause = await createEvent('测试：案例关联原因');
      const effect = await createEvent('测试：案例关联结果');
      const newContents = Array.from(
        { length: 6 },
        (_, index) => `2026年关系测试新案例${index + 1}`,
      );
      const createdResponse = await createRelation(cause.id, effect.id, {
        confidence: 64,
        caseSelections: [
          { type: 'existing', caseId: existingCase.id },
          ...newContents.map((content) => ({ type: 'new' as const, content })),
        ],
      });
      const created = createdResponse.json<RelationDetail>();
      expect(createdResponse.statusCode).toBe(201);
      expect(created.caseCount).toBe(7);
      expect(created.recentCases).toHaveLength(5);
      expect(created.confidence).toBe(64);
      const linkCounts = await pool!.query<{ content: string; count: number }>(
        `select c.content, count(*)::int as count
         from causal_relation_cases crc
         join concrete_cases c on c.id = crc.concrete_case_id
         where crc.causal_relation_id = $1
         group by c.content
         order by c.content`,
        [created.id],
      );
      expect(linkCounts.rows).toHaveLength(7);
      expect(linkCounts.rows.every((row) => row.count === 1)).toBe(true);
      const batchAudit = await pool!.query<{ inserted_count: number }>(
        `select inserted_count from relation_case_batch_audit`,
      );
      expect(batchAudit.rows).toEqual([{ inserted_count: 6 }]);

      const replaced = await app!.inject({
        method: 'PUT',
        url: `/api/relations/${created.id}`,
        payload: {
          causeEventId: cause.id,
          effectEventId: effect.id,
          confidence: 64,
          description: null,
          caseSelections: [{ type: 'existing', caseId: existingCase.id }],
        },
      });
      expect(replaced.statusCode).toBe(200);
      expect(replaced.json<RelationDetail>()).toMatchObject({ caseCount: 1, confidence: 64 });
      const independentCount = await pool!.query<{ count: string }>(
        `select count(*) from concrete_cases where content = any($1::text[])`,
        [newContents],
      );
      expect(independentCount.rows[0]?.count).toBe('6');
    } finally {
      await pool!.query(
        `drop trigger if exists audit_relation_case_batch_trigger on concrete_cases`,
      );
      await pool!.query(`drop function if exists audit_relation_case_batch()`);
      await pool!.query(`drop table if exists relation_case_batch_audit`);
    }
  });

  it('paginates relation-detail cases with cursors bound to the relation id', async () => {
    const cause = await createEvent('测试：详情案例游标原因');
    const effect = await createEvent('测试：详情案例游标结果');
    const contents = Array.from({ length: 3 }, (_, index) => `关系详情游标案例 ${index + 1}`);
    const created = (
      await createRelation(cause.id, effect.id, {
        caseSelections: contents.map((content) => ({ type: 'new' as const, content })),
      })
    ).json<RelationDetail>();
    const otherCause = await createEvent('测试：详情案例游标其他原因');
    const otherEffect = await createEvent('测试：详情案例游标其他结果');
    const other = (await createRelation(otherCause.id, otherEffect.id)).json<RelationDetail>();

    const first = await app!.inject({
      method: 'GET',
      url: `/api/relations/${created.id}/cases?limit=2`,
    });
    const firstPage = first.json<{
      items: Array<{ id: string; content: string }>;
      nextCursor: string | null;
      hasMore: boolean;
    }>();
    const second = await app!.inject({
      method: 'GET',
      url: `/api/relations/${created.id}/cases?limit=2&cursor=${encodeURIComponent(firstPage.nextCursor!)}`,
    });
    const mismatch = await app!.inject({
      method: 'GET',
      url: `/api/relations/${other.id}/cases?limit=2&cursor=${encodeURIComponent(firstPage.nextCursor!)}`,
    });

    expect(first.statusCode).toBe(200);
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(second.statusCode).toBe(200);
    expect(second.json<{ items: unknown[]; hasMore: boolean }>().items).toHaveLength(1);
    expect(second.json<{ items: unknown[]; hasMore: boolean }>().hasMore).toBe(false);
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rolls back a relation and new cases when an existing selection is missing', async () => {
    const cause = await createEvent('测试：回滚原因');
    const effect = await createEvent('测试：回滚结果');
    const content = '2026年关系事务回滚案例';
    const response = await createRelation(cause.id, effect.id, {
      caseSelections: [
        { type: 'new', content },
        { type: 'existing', caseId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' },
      ],
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'CASE_NOT_FOUND' });
    const counts = await pool!.query<{ cases: string; relations: string }>(
      `select
         (select count(*) from concrete_cases where content = $1) as cases,
         (select count(*) from causal_relations
          where cause_event_id = $2 and effect_event_id = $3) as relations`,
      [content, cause.id, effect.id],
    );
    expect(counts.rows[0]).toEqual({ cases: '0', relations: '0' });
  });

  it('rolls back every new case when one requested content already exists', async () => {
    const conflictContent = '2026年关系内容冲突已有案例';
    const existingCase = (
      await app!.inject({
        method: 'POST',
        url: '/api/cases',
        payload: { content: conflictContent },
      })
    ).json<CaseDetail>();
    const cause = await createEvent('测试：内容冲突回滚原因');
    const effect = await createEvent('测试：内容冲突回滚结果');
    const newContents = ['2026年关系内容冲突前新案例', '2026年关系内容冲突后新案例'];

    const response = await createRelation(cause.id, effect.id, {
      caseSelections: [
        { type: 'new', content: newContents[0]! },
        { type: 'new', content: conflictContent },
        { type: 'new', content: newContents[1]! },
      ],
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: 'CASE_CONTENT_CONFLICT',
      existingId: existingCase.id,
    });
    const counts = await pool!.query<{ cases: string; relations: string }>(
      `select
         (select count(*) from concrete_cases where content = any($1::text[])) as cases,
         (select count(*) from causal_relations
          where cause_event_id = $2 and effect_event_id = $3) as relations`,
      [newContents, cause.id, effect.id],
    );
    expect(counts.rows[0]).toEqual({ cases: '0', relations: '0' });
  });

  it('searches cause/effect names, aliases, and descriptions', async () => {
    const cause = await createEvent('测试：库存回补', ['RELATION_ALIAS_TOKEN']);
    const effect = await createEvent('测试：产量提高');
    await createRelation(cause.id, effect.id, { description: 'RELATION_DESC_TOKEN 传导' });

    for (const query of ['库存回补', 'RELATION_ALIAS_TOKEN', 'RELATION_DESC_TOKEN']) {
      const response = await app!.inject({
        method: 'GET',
        url: `/api/relations?q=${encodeURIComponent(query)}`,
      });
      expect(response.statusCode).toBe(200);
      expect(
        response.json<RelationListResponse>().items.some((item) => item.causeEvent.id === cause.id),
      ).toBe(true);
    }
  });

  it('ranks standard-name matches before alias matches', async () => {
    const token = 'RELATION_RANK_TOKEN';
    const exactCause = await createEvent(token);
    const exactEffect = await createEvent('测试：精确名称结果');
    const aliasCause = await createEvent('测试：别名排序原因', [token]);
    const aliasEffect = await createEvent('测试：别名排序结果');
    const exactRelation = (
      await createRelation(exactCause.id, exactEffect.id)
    ).json<RelationDetail>();
    const aliasRelation = (
      await createRelation(aliasCause.id, aliasEffect.id)
    ).json<RelationDetail>();

    const response = await app!.inject({
      method: 'GET',
      url: `/api/relations?q=${token}&limit=20`,
    });
    const ids = response.json<RelationListResponse>().items.map((item) => item.id);
    expect(ids.indexOf(exactRelation.id)).toBeLessThan(ids.indexOf(aliasRelation.id));
  });

  it('returns numbered pages, matching totals, and clamps an out-of-range page', async () => {
    const cause = await createEvent('RELATION_PAGE_TOKEN 共同原因');
    for (let index = 1; index <= 31; index += 1) {
      const effect = await createEvent(`测试：页码结果 ${String(index).padStart(2, '0')}`);
      await createRelation(cause.id, effect.id);
    }
    const unrelatedCause = await createEvent('测试：页码计数无关原因');
    const unrelatedEffect = await createEvent('测试：页码计数无关结果');
    await createRelation(unrelatedCause.id, unrelatedEffect.id);
    const first = (
      await app!.inject({
        method: 'GET',
        url: '/api/relations?q=RELATION_PAGE_TOKEN&page=1&limit=30',
      })
    ).json<RelationListResponse>();
    const secondResponse = await app!.inject({
      method: 'GET',
      url: '/api/relations?q=RELATION_PAGE_TOKEN&page=2&limit=30',
    });
    const second = secondResponse.json<RelationListResponse>();
    const clamped = (
      await app!.inject({
        method: 'GET',
        url: '/api/relations?q=RELATION_PAGE_TOKEN&page=999&limit=30',
      })
    ).json<RelationListResponse>();
    expect(first).toMatchObject({ page: 1, pageSize: 30, totalItems: 31, totalPages: 2 });
    expect(first.items).toHaveLength(30);
    expect(second).toMatchObject({ page: 2, pageSize: 30, totalItems: 31, totalPages: 2 });
    expect(second.items).toHaveLength(1);
    expect(second.items.map((item) => item.id)).not.toEqual(
      expect.arrayContaining(first.items.map((item) => item.id)),
    );
    expect(clamped).toMatchObject({ page: 2, pageSize: 30, totalItems: 31, totalPages: 2 });
    expect(clamped.items).toHaveLength(1);
  });

  it('returns not found and publishes relation paths in OpenAPI', async () => {
    const missingId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    expect(
      (await app!.inject({ method: 'GET', url: `/api/relations/${missingId}` })).statusCode,
    ).toBe(404);
    const paths = (await app!.inject({ method: 'GET', url: '/api/openapi.json' })).json<{
      paths: Record<string, unknown>;
    }>().paths;
    expect(paths).toHaveProperty('/api/relations');
    expect(paths).toHaveProperty('/api/relations/pair-check');
    expect(paths).toHaveProperty('/api/relations/{relationId}');
  });
});
