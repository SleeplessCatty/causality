import type {
  EventCandidateListResponse,
  EventDetail,
  EventListResponse,
} from '@causality/contracts';
import { Pool } from 'pg';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { runMigrations } from '../src/database/migrate.js';

describe.sequential('event REST API', () => {
  let container: StartedTestContainer | undefined;
  let pool: Pool | undefined;
  let app: ReturnType<typeof buildApp> | undefined;

  beforeAll(async () => {
    container = await new GenericContainer('postgres:18.4-alpine')
      .withEnvironment({
        POSTGRES_DB: 'causality_events_test',
        POSTGRES_USER: 'causality',
        POSTGRES_PASSWORD: 'causality',
      })
      .withExposedPorts(5432)
      .withHealthCheck({
        test: ['CMD-SHELL', 'pg_isready -U causality -d causality_events_test'],
        interval: 1_000,
        timeout: 3_000,
        retries: 30,
      })
      .withWaitStrategy(Wait.forHealthCheck())
      .withStartupTimeout(120_000)
      .start();

    pool = new Pool({
      connectionString: `postgresql://causality:causality@${container.getHost()}:${container.getMappedPort(5432)}/causality_events_test`,
    });
    await runMigrations(pool);
    app = buildApp({
      logger: false,
      checkDatabase: async () => true,
      databasePool: pool,
    });
    await app.ready();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await container?.stop();
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
    const update = await app!.inject({
      method: 'PUT',
      url: `/api/events/${missingId}`,
      payload: { name: '测试：不存在', description: null, aliases: [], keywords: [] },
    });

    expect(detail.statusCode).toBe(404);
    expect(update.statusCode).toBe(404);
    expect(detail.json()).toMatchObject({ code: 'EVENT_NOT_FOUND' });
  });

  it('paginates the default list without duplicate rows', async () => {
    for (const index of [1, 2, 3, 4]) {
      await createEvent(`测试：游标事件 ${index}`);
    }

    const first = await app!.inject({ method: 'GET', url: '/api/events?limit=2' });
    const firstPage = first.json<EventListResponse>();
    const second = await app!.inject({
      method: 'GET',
      url: `/api/events?limit=2&cursor=${encodeURIComponent(firstPage.nextCursor!)}`,
    });
    const secondPage = second.json<EventListResponse>();

    expect(first.statusCode).toBe(200);
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(second.statusCode).toBe(200);
    expect(secondPage.items).toHaveLength(2);
    expect(secondPage.items.map((event) => event.id)).not.toEqual(
      expect.arrayContaining(firstPage.items.map((event) => event.id)),
    );
  });

  it('rejects an invalid pagination cursor as a client error', async () => {
    const response = await app!.inject({
      method: 'GET',
      url: '/api/events?cursor=not-a-valid-cursor',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      code: 'VALIDATION_ERROR',
      message: '分页游标不合法',
    });
  });

  it('searches names, aliases, and keywords with stable ranking', async () => {
    await createEvent('SEARCHTOKEN 标准名称', { aliases: ['其他别名'] });
    await createEvent('测试：包含 SEARCHTOKEN 的名称');
    await createEvent('测试：别名命中项', { aliases: ['SEARCHTOKEN'] });
    await createEvent('测试：关键词命中项', { keywords: ['SEARCHTOKEN'] });

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

  it('publishes event paths in OpenAPI', async () => {
    const response = await app!.inject({ method: 'GET', url: '/api/openapi.json' });
    const paths = response.json<{ paths: Record<string, unknown> }>().paths;

    expect(paths).toHaveProperty('/api/events');
    expect(paths).toHaveProperty('/api/events/candidates');
    expect(paths).toHaveProperty('/api/events/{eventId}');
  });
});
