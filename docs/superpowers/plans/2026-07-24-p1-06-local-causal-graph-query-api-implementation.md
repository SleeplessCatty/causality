# P1-06 Local Causal Graph Query API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现一个以原子事件为中心、支持上游/下游/双向、筛选和 20/50/100 节点档位的只读局部因果图查询 API。

**Architecture:** 共享契约负责严格校验请求和响应；API Service 在只读可重复读事务内执行应用层分层 BFS；PostgreSQL Repository 每层使用一次批量 SQL，并在节点确定后一次查询节点间完整关系。节点或关系达到保护上限时立即停止，不计算完整可达数量。

**Tech Stack:** TypeScript 6、Zod 4、Fastify 5、node-postgres 8、PostgreSQL 18、Vitest 4、Testcontainers 12、pnpm 11。

## Global Constraints

- 中心事件不计入 `20 | 50 | 100` 节点上限，响应节点数最多为 `21 | 51 | 101`。
- 遍历采用分层 BFS；同层关系按置信度降序、案例数降序、关系 ID 升序。
- `both` 共用候选队列，不为上下游预留配额。
- 只返回所选节点之间全部满足筛选条件的关系，不按遍历方向删边。
- 关系上限固定为 `200 | 500 | 1000`；超限时缩小到最大稳定节点前缀，不截断前缀内部关系。
- 不返回 `hasMore` 或完整可达数量；达到节点档位后不查询下一层。
- 一次查询必须使用同一个 PostgreSQL 连接和 `repeatable read read only` 事务。
- 不新增图数据库、缓存、图会话、数据库表或默认迁移。
- 极端基准数据为 100,000 个事件和 500,000 条关系，100 节点查询 P95 不超过 2 秒。

---

### Task 1: Shared causal graph contracts

**Files:**

- Create: `packages/contracts/src/causal-graph/causalGraphSchemas.ts`
- Create: `packages/contracts/test/causal-graph.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**

- Produces: `causalGraphQuerySchema`, `causalGraphResponseSchema`, `CausalGraphQuery`, `CausalGraphResponse`, `CausalGraphNode`, `CausalGraphRelation`, `CausalGraphStopReason`。
- Query defaults: `limit=20`, `minConfidence=0`, `minCaseCount=0`；`centerEventId` 和 `direction` 必填。

- [x] **Step 1: Write failing contract tests**

```ts
const centerEventId = '11111111-1111-4111-8111-111111111111';

expect(
  causalGraphQuerySchema.parse({ centerEventId, direction: 'both' }),
).toEqual({
  centerEventId,
  direction: 'both',
  limit: 20,
  minConfidence: 0,
  minCaseCount: 0,
});

expect(
  causalGraphQuerySchema.parse({
    centerEventId,
    direction: 'upstream',
    limit: '100',
    minConfidence: '75',
    minCaseCount: '3',
  }),
).toEqual({
  centerEventId,
  direction: 'upstream',
  limit: 100,
  minConfidence: 75,
  minCaseCount: 3,
});

for (const invalid of [
  { centerEventId, direction: 'sideways' },
  { centerEventId, direction: 'both', limit: 30 },
  { centerEventId, direction: 'both', minConfidence: 101 },
  { centerEventId, direction: 'both', minCaseCount: -1 },
]) {
  expect(causalGraphQuerySchema.safeParse(invalid).success).toBe(false);
}
```

Also parse a complete response and reject extra node, relation, and meta fields so the response remains strict.

- [x] **Step 2: Run the contract test and verify RED**

Run: `pnpm --filter @causality/contracts test -- causal-graph.test.ts`

Expected: FAIL because `causalGraphSchemas.ts` and its exports do not exist.

- [x] **Step 3: Implement strict schemas and types**

```ts
const graphLimitSchema = z.union([z.literal(20), z.literal(50), z.literal(100)]);

export const causalGraphQuerySchema = z
  .object({
    centerEventId: z.uuid(),
    direction: z.enum(['upstream', 'downstream', 'both']),
    limit: z.coerce.number().pipe(graphLimitSchema).default(20),
    minConfidence: z.coerce.number().int().min(0).max(100).default(0),
    minCaseCount: z.coerce.number().int().nonnegative().default(0),
  })
  .strict();

export const causalGraphNodeSchema = z
  .object({ id: z.uuid(), name: z.string().trim().min(1).max(120) })
  .strict();

export const causalGraphRelationSchema = z
  .object({
    id: z.uuid(),
    causeEventId: z.uuid(),
    effectEventId: z.uuid(),
    confidence: z.number().int().min(0).max(100),
    caseCount: z.number().int().nonnegative(),
  })
  .strict();

export const causalGraphResponseSchema = z
  .object({
    nodes: z.array(causalGraphNodeSchema).max(101),
    relations: z.array(causalGraphRelationSchema).max(1_000),
    meta: z
      .object({
        centerEventId: z.uuid(),
        direction: z.enum(['upstream', 'downstream', 'both']),
        nodeLimit: graphLimitSchema,
        relationLimit: z.union([z.literal(200), z.literal(500), z.literal(1_000)]),
        minConfidence: z.number().int().min(0).max(100),
        minCaseCount: z.number().int().nonnegative(),
        nodeCount: z.number().int().min(1).max(101),
        relationCount: z.number().int().min(0).max(1_000),
        stopReason: z.enum(['exhausted', 'node_limit', 'relation_limit']),
      })
      .strict(),
  })
  .strict();
```

Export all schemas and inferred types from `packages/contracts/src/index.ts`.

- [x] **Step 4: Verify GREEN and contract regressions**

Run: `pnpm --filter @causality/contracts test`

Expected: all contract tests PASS.

- [x] **Step 5: Commit**

```bash
git add packages/contracts/src/causal-graph packages/contracts/src/index.ts packages/contracts/test/causal-graph.test.ts
git commit -m "feat: add causal graph API contracts"
```

### Task 2: Deterministic BFS service

**Files:**

- Create: `apps/api/src/features/causal-graph/causalGraphTypes.ts`
- Create: `apps/api/src/features/causal-graph/causalGraphService.ts`
- Create: `apps/api/test/causal-graph-service.test.ts`

**Interfaces:**

- Consumes: `CausalGraphQuery` and `CausalGraphResponse` from Task 1.
- Produces: `CausalGraphRepository`, `CausalGraphSnapshot`, `CausalGraphService`, `CausalGraphServiceError`.
- Snapshot methods:

```ts
interface CausalGraphSnapshot {
  findEvent(id: string): Promise<CausalGraphNode | null>;
  findEvents(ids: string[]): Promise<CausalGraphNode[]>;
  findAdjacentRelations(
    eventIds: string[],
    direction: CausalGraphQuery['direction'],
    filters: CausalGraphFilters,
  ): Promise<CausalGraphRelation[]>;
  findRelationsBetween(
    eventIds: string[],
    filters: CausalGraphFilters,
  ): Promise<CausalGraphRelation[]>;
}

interface CausalGraphRepository {
  withSnapshot<T>(operation: (snapshot: CausalGraphSnapshot) => Promise<T>): Promise<T>;
}
```

- [x] **Step 1: Write failing BFS tests**

Build an in-memory repository that records each frontier passed to `findAdjacentRelations`. Cover these behaviors with separate tests:

```ts
it('discovers by layer and sorts same-layer candidates deterministically', async () => {
  const graph = await service.query(query({ direction: 'downstream', limit: 20 }));
  expect(graph.nodes.map((node) => node.id)).toEqual([center, highConfidence, highCases, low]);
  expect(frontierCalls).toEqual([[center], [highConfidence, highCases, low]]);
});

it('uses one queue for both directions and de-duplicates cycles', async () => {
  const graph = await service.query(query({ direction: 'both' }));
  expect(graph.nodes.map((node) => node.id)).toEqual([center, upstreamNode, downstreamNode]);
  expect(new Set(graph.nodes.map((node) => node.id)).size).toBe(graph.nodes.length);
});

it('stops at the requested non-center node limit without querying another layer', async () => {
  const graph = await service.query(query({ limit: 20 }));
  expect(graph.nodes).toHaveLength(21);
  expect(graph.meta.stopReason).toBe('node_limit');
  expect(frontierCalls).toHaveLength(1);
});

it('returns all filtered relations between selected nodes regardless of traversal direction', async () => {
  const graph = await service.query(query({ direction: 'downstream' }));
  expect(graph.relations.map((relation) => relation.id)).toEqual([
    discoveryRelation,
    reverseRelation,
    crossRelation,
  ]);
});

it('shrinks to the largest stable node prefix when complete relations exceed the cap', async () => {
  const graph = await service.query(query({ limit: 20 }));
  expect(graph.relations.length).toBeLessThanOrEqual(200);
  expect(graph.relations.every((edge) => graph.nodes.some((node) => node.id === edge.causeEventId))).toBe(true);
  expect(graph.meta.stopReason).toBe('relation_limit');
});
```

Also cover upstream-only traversal, isolated center, missing center, filter forwarding, transaction failure propagation, stable relation sorting, and 50/100 → 500/1000 relation-limit mapping.

- [x] **Step 2: Run the service test and verify RED**

Run: `pnpm --filter @causality/api test -- causal-graph-service.test.ts`

Expected: FAIL because the causal graph service module does not exist.

- [x] **Step 3: Implement the minimal deterministic service**

```ts
const relationLimits = { 20: 200, 50: 500, 100: 1_000 } as const;

export class CausalGraphService {
  constructor(private readonly repository: CausalGraphRepository) {}

  query(query: CausalGraphQuery): Promise<CausalGraphResponse> {
    return this.repository.withSnapshot(async (snapshot) => {
      const center = await snapshot.findEvent(query.centerEventId);
      if (!center) throw new CausalGraphServiceError('EVENT_NOT_FOUND', '中心事件不存在');

      const filters = {
        minConfidence: query.minConfidence,
        minCaseCount: query.minCaseCount,
      };
      const nodes = [center];
      const visited = new Set([center.id]);
      let frontier = [center.id];
      let stopReason: CausalGraphStopReason = 'exhausted';

      while (frontier.length > 0 && nodes.length - 1 < query.limit) {
        const candidates = sortRelations(
          await snapshot.findAdjacentRelations(frontier, query.direction, filters),
        );
        const frontierSet = new Set(frontier);
        const nextIds: string[] = [];

        for (const relation of candidates) {
          for (const neighborId of adjacentUnvisitedIds(relation, frontierSet, query.direction)) {
            if (visited.has(neighborId)) continue;
            visited.add(neighborId);
            nextIds.push(neighborId);
            if (nodes.length - 1 + nextIds.length === query.limit) {
              stopReason = 'node_limit';
              break;
            }
          }
          if (stopReason === 'node_limit') break;
        }

        const eventsById = new Map(
          (await snapshot.findEvents(nextIds)).map((event) => [event.id, event]),
        );
        for (const id of nextIds) {
          const event = eventsById.get(id);
          if (!event) throw new Error(`Graph endpoint event missing: ${id}`);
          nodes.push(event);
        }

        if (stopReason === 'node_limit') break;
        frontier = nextIds;
      }

      const completeRelations = sortRelations(
        await snapshot.findRelationsBetween(nodes.map((node) => node.id), filters),
      );
      return applyRelationLimit(nodes, completeRelations, query, stopReason);
    });
  }
}
```

`findEvents(ids)` is called once per layer and Service reorders its result using `nextIds`, so PostgreSQL row order cannot change discovery order.

`applyRelationLimit` must index discovery order, count a relation when both endpoint indexes are inside the prefix, and return the final prefix plus only its internal relations. Populate all `meta` counts from the final arrays.

- [x] **Step 4: Verify GREEN and API unit regressions**

Run: `pnpm --filter @causality/api test`

Expected: all API unit tests PASS.

- [x] **Step 5: Commit**

```bash
git add apps/api/src/features/causal-graph apps/api/test/causal-graph-service.test.ts
git commit -m "feat: add deterministic causal graph traversal"
```

### Task 3: PostgreSQL snapshot repository and HTTP endpoint

**Files:**

- Create: `apps/api/src/features/causal-graph/causalGraphRepository.ts`
- Create: `apps/api/src/features/causal-graph/causalGraphRoutes.ts`
- Create: `apps/api/test/causal-graph.integration.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**

- Consumes: service and repository interfaces from Task 2; schemas from Task 1.
- Produces: `PostgresCausalGraphRepository` and `registerCausalGraphRoutes(app, pool)`.
- Endpoint: `GET /api/causal-graph`.

- [x] **Step 1: Write failing PostgreSQL/API integration tests**

Create one PostgreSQL 18 Testcontainer, migrate it, and insert a deterministic fixture containing:

```text
A → B confidence 90, cases 2
A → C confidence 90, cases 1
B → D confidence 80, cases 0
C → D confidence 70, cases 3
D → A confidence 60, cases 0
B → A confidence 50, cases 0
```

Verify:

```ts
const response = await app.inject({
  method: 'GET',
  url: `/api/causal-graph?centerEventId=${a}&direction=downstream&limit=20`,
});
expect(response.statusCode).toBe(200);
expect(response.json<CausalGraphResponse>()).toMatchObject({
  nodes: [{ id: a }, { id: b }, { id: c }, { id: d }],
  meta: { stopReason: 'exhausted', nodeCount: 4, relationCount: 6 },
});
```

Add assertions for upstream, both, `minConfidence`, `minCaseCount`, isolated center, missing center 404, invalid params 400, stable repeat calls, complete reverse/cycle relations, OpenAPI publication, and exact response fields.

For the transaction boundary, inject a small fake `Pool`/`PoolClient` into `PostgresCausalGraphRepository` and assert the command order:

```ts
expect(commands).toEqual([
  'begin transaction isolation level repeatable read read only',
  expect.stringContaining('select'),
  'commit',
]);
expect(release).toHaveBeenCalledOnce();
```

Repeat with an operation error and assert `rollback` followed by `release`.

- [x] **Step 2: Run integration test and verify RED**

Run: `pnpm test:integration -- causal-graph.integration.test.ts`

Expected: FAIL because the route and PostgreSQL repository do not exist.

- [x] **Step 3: Implement the snapshot repository**

Use one checked-out `PoolClient`:

```ts
async withSnapshot<T>(operation: (snapshot: CausalGraphSnapshot) => Promise<T>): Promise<T> {
  const client = await this.pool.connect();
  try {
    await client.query('begin transaction isolation level repeatable read read only');
    const result = await operation(new PostgresCausalGraphSnapshot(client));
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
```

Use parameterized batch SQL. Adjacent relation shape:

```sql
select r.id,
       r.cause_event_id,
       r.effect_event_id,
       r.confidence,
       count(crc.concrete_case_id)::int as case_count
from causal_relations r
left join causal_relation_cases crc on crc.causal_relation_id = r.id
where r.confidence >= $2
  and (
    -- direction-specific expression using = any($1::uuid[])
  )
group by r.id
having count(crc.concrete_case_id) >= $3
order by r.confidence desc, case_count desc, r.id asc
```

`findRelationsBetween` requires both endpoints in `$1::uuid[]`. `findEvents` uses one `where id = any($1::uuid[])` query and returns a map/array that Service reorders by candidate discovery order.

- [x] **Step 4: Implement and register the Fastify route**

```ts
routes.get(
  '/api/causal-graph',
  {
    schema: {
      tags: ['causal-graph'],
      querystring: causalGraphQuerySchema,
      response: {
        200: causalGraphResponseSchema,
        400: apiErrorSchema,
        404: apiErrorSchema,
        500: apiErrorSchema,
      },
    },
  },
  async (request, reply) => {
    try {
      return await service.query(request.query);
    } catch (error) {
      if (error instanceof CausalGraphServiceError && error.code === 'EVENT_NOT_FOUND') {
        return reply.status(404).send({ code: 'EVENT_NOT_FOUND', message: error.message });
      }
      throw error;
    }
  },
);
```

Register it in `buildApp` only when `databasePool` exists, consistent with events, relations, and cases.

- [x] **Step 5: Verify GREEN, integration suite, types, and build**

Run:

```bash
pnpm test:integration
pnpm typecheck
pnpm build
```

Expected: all commands exit 0.

- [x] **Step 6: Commit**

```bash
git add apps/api/src/features/causal-graph apps/api/src/app.ts apps/api/test/causal-graph.integration.test.ts
git commit -m "feat: expose local causal graph query API"
```

### Task 4: Extreme-scale benchmark, documentation, and phase verification

**Files:**

- Create: `apps/api/src/database/benchmark/causalGraphBenchmark.ts`
- Create: `apps/api/test/causal-graph-benchmark.test.ts`
- Modify: `apps/api/package.json`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-07-20-causality-application-roadmap.md`

**Interfaces:**

- Produces: root command `pnpm graph:benchmark`.
- Default benchmark scale: 100,000 events, 500,000 relations; output includes samples, average, P95, maximum, threshold, and pass/fail.

- [x] **Step 1: Write failing benchmark utility tests**

Test pure calculations independently from Docker:

```ts
expect(percentile95([10, 20, 30, 40, 50])).toBe(50);
expect(summarizeDurations([10, 20, 30])).toEqual({
  samples: 3,
  averageMilliseconds: 20,
  p95Milliseconds: 30,
  maximumMilliseconds: 30,
});
```

Test that `assertBenchmarkTarget({ p95Milliseconds: 2_001 }, 2_000)` throws and a P95 of 2,000 passes.

- [x] **Step 2: Run benchmark utility tests and verify RED**

Run: `pnpm --filter @causality/api test -- causal-graph-benchmark.test.ts`

Expected: FAIL because the benchmark module does not exist.

- [x] **Step 3: Implement benchmark command**

The command must:

1. start a disposable PostgreSQL 18 Testcontainer;
2. run migrations;
3. seed exactly 100,000 events and 500,000 relations with deterministic batch inserts;
4. include case links so `minCaseCount` paths are exercised;
5. select low-, medium-, and high-degree centers from SQL degree counts;
6. warm each query once;
7. execute upstream, downstream, and both at `limit=100`, plus confidence, case-count, and combined filters;
8. record `performance.now()` duration for every sample;
9. print JSON summary and throw when P95 exceeds 2,000 ms;
10. always close the pool and stop the container.

Expose:

```json
{
  "scripts": {
    "graph:benchmark": "tsx src/database/benchmark/causalGraphBenchmark.ts"
  }
}
```

and root delegation:

```json
{
  "scripts": {
    "graph:benchmark": "pnpm --filter @causality/api graph:benchmark"
  }
}
```

- [x] **Step 4: Verify benchmark unit tests and run the full extreme benchmark**

Run:

```bash
pnpm --filter @causality/api test -- causal-graph-benchmark.test.ts
pnpm graph:benchmark
```

Expected: utility tests PASS; generated report shows `p95Milliseconds <= 2000` and exits 0. If it fails, inspect `EXPLAIN (ANALYZE, BUFFERS)` for the slow query before adding any migration or index.

- [x] **Step 5: Update user documentation and roadmap**

Add to README:

```text
GET /api/causal-graph：以中心事件查询上游、下游或双向局部因果图；支持 20/50/100 节点档位、最低置信度和最低案例数筛选。
pnpm graph:benchmark：在一次性 PostgreSQL 中验证 100,000 事件、500,000 关系的查询性能。
```

Keep roadmap state as “开发完成，等待人工复核” after all automated gates pass. Do not mark P1-06 complete before user confirmation.

- [x] **Step 6: Run the complete automated gate**

Run:

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
git diff --check
```

Expected: every command exits 0, with no test failures or formatting errors.

- [x] **Step 7: Commit**

```bash
git add apps/api/src/database/benchmark apps/api/test/causal-graph-benchmark.test.ts apps/api/package.json package.json README.md docs/superpowers/plans/2026-07-20-causality-application-roadmap.md docs/superpowers/plans/2026-07-24-p1-06-local-causal-graph-query-api-implementation.md
git commit -m "test: add causal graph performance gate"
```

After the commit, stop and provide the manual curl review checklist from the approved P1-06 design. Do not start P1-07 until the user explicitly reports that P1-06 verification succeeded.
