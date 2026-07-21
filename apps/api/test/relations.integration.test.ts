import type { EventDetail, RelationDetail, RelationListResponse } from '@causality/contracts';
import { Pool } from 'pg';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { runMigrations } from '../src/database/migrate.js';

describe.sequential('relation REST API', () => {
  let container: StartedTestContainer | undefined;
  let pool: Pool | undefined;
  let app: ReturnType<typeof buildApp> | undefined;
  let eventSequence = 0;

  beforeAll(async () => {
    container = await new GenericContainer('postgres:18.4-alpine')
      .withEnvironment({
        POSTGRES_DB: 'causality_relations_test',
        POSTGRES_USER: 'causality',
        POSTGRES_PASSWORD: 'causality',
      })
      .withExposedPorts(5432)
      .withHealthCheck({
        test: ['CMD-SHELL', 'pg_isready -U causality -d causality_relations_test'],
        interval: 1_000,
        timeout: 3_000,
        retries: 30,
      })
      .withWaitStrategy(Wait.forHealthCheck())
      .withStartupTimeout(120_000)
      .start();
    pool = new Pool({
      connectionString: `postgresql://causality:causality@${container.getHost()}:${container.getMappedPort(5432)}/causality_relations_test`,
    });
    await runMigrations(pool);
    app = buildApp({ logger: false, checkDatabase: async () => true, databasePool: pool });
    await app.ready();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await container?.stop();
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
    overrides: Partial<{ confidence: number; description: string | null }> = {},
  ) {
    return app!.inject({
      method: 'POST',
      url: '/api/relations',
      payload: {
        causeEventId,
        effectEventId,
        confidence: overrides.confidence ?? 70,
        description: overrides.description ?? null,
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
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      effectEvent: { id: newEffect.id },
      confidence: 91,
      description: '汇率变化传导',
    });
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

  it('paginates without duplicate rows and rejects invalid cursors', async () => {
    for (const index of [1, 2, 3]) {
      const cause = await createEvent(`测试：游标原因 ${index}`);
      const effect = await createEvent(`测试：游标结果 ${index}`);
      await createRelation(cause.id, effect.id);
    }
    const first = (
      await app!.inject({ method: 'GET', url: '/api/relations?limit=2' })
    ).json<RelationListResponse>();
    const secondResponse = await app!.inject({
      method: 'GET',
      url: `/api/relations?limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`,
    });
    const second = secondResponse.json<RelationListResponse>();
    expect(first.hasMore).toBe(true);
    expect(second.items.map((item) => item.id)).not.toEqual(
      expect.arrayContaining(first.items.map((item) => item.id)),
    );
    expect(
      (await app!.inject({ method: 'GET', url: '/api/relations?cursor=invalid' })).statusCode,
    ).toBe(400);
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
