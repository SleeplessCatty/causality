# Causality v0.1.0 Release Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复第一期最终代码审计发现的功能、查询成本、重复代码和交付文档问题，使 `v0.1.0` 具备可重复构建、完整门禁通过和适合公开 GitHub 仓库的正式说明。

**Architecture:** 保持现有 React、Fastify、PostgreSQL、Cytoscape/ELK 和前后端分离结构，不增加新的运行时服务。整改优先修复可见的数据遗漏和无界数据库工作量，再收敛共享基础设施与遗留代码，最后以重新编写的 README 和全量发布门禁形成正式版本交付。

**Tech Stack:** Node.js 24.18.0、pnpm 11.15.1、TypeScript 6.0.2、React 19.2.7、Fastify 5.10.0、PostgreSQL 18.4、Drizzle ORM 0.45.2、TanStack Query 5.101.3、Vitest 4.1.10、Playwright 1.61.1、Docker Compose。

## Global Constraints

- 本轮只做第一期正式发布整改，不加入 AI、语义搜索、自动推理、用户系统、删除功能或移动端适配。
- 保持现有数据库业务含义、REST 路径和桌面端视觉风格；允许三个主列表 API 将游标响应改为页码响应，并保留单次关系表单最多关联 `1,000` 条具体案例的输入限制。
- 候选搜索仍不限制匹配结果总数，不显示匹配原因、分页批次或完整匹配数量。
- 原子事件、因果关系和具体案例三个主列表固定默认每页 `30` 条，支持页码、任意页跳转、当前页、总页数和总条目数；候选搜索、案例详情关系和关系详情案例继续使用游标“加载更多”。
- 局部图响应仍最多包含 `100` 个非中心节点和 `1,000` 条关系；节点预算必须同时约束数据库遍历工作量。
- 案例详情每批显示 `30` 条关联关系，关系详情每批显示 `100` 条关联案例；两者都由用户显式点击“加载更多”，不自动读取全部分页。
- 所有数据库结构变化使用新增迁移完成；禁止修改已执行迁移、静默截断用户数据或要求重建数据库。
- README 面向首次访问 GitHub 仓库的使用者，不再记录 P1、UX 编号、开发过程、历史测试数量或人工复核状态。
- 每个任务均先写失败测试，再做最小实现；任务完成后运行其局部测试和全局静态检查。
- 本计划通过审核后才进入代码实施；所有 Web 变化在自动化通过后仍需要用户人工复核。

---

## 1. 文件结构与职责

### 新增文件

- `apps/api/src/database/schema/eventKeywords.ts`：规范化事件关键词表及 trigram 索引。
- `apps/api/src/features/shared/sqlSearch.ts`：统一查询规范化和 SQL `LIKE` 转义。
- `apps/api/test/support/integrationGlobalSetup.ts`：每次集成测试运行只启动一个 PostgreSQL 容器。
- `apps/api/test/support/postgresTestContext.ts`：为各测试文件创建隔离数据库，并管理迁移、连接池和 Fastify 生命周期。
- `apps/web/src/shared/api/httpClient.ts`：统一超时、JSON 请求、错误解析和 `ApiClientError`。
- `apps/web/src/shared/api/httpClient.test.ts`：共享 HTTP 客户端行为测试。
- `database/migrations/0005_event_keywords.sql`：将关键词数组无损迁移到索引表。

### 主要修改文件

- `apps/web/src/features/cases/pages/CaseDetailPage.tsx`：关联关系游标分页和“加载更多”。
- `apps/web/src/features/relations/pages/RelationDetailPage.tsx`：停止自动拉完案例，改为显式加载。
- `apps/api/src/features/causal-graph/causalGraphTypes.ts`：把遍历接口改成有预算的相邻事件查询。
- `apps/api/src/features/causal-graph/causalGraphRepository.ts`：在 SQL 内排除已访问节点、排序、去重和限量。
- `apps/api/src/features/causal-graph/causalGraphService.ts`：按剩余节点预算逐层查询。
- `apps/api/src/database/benchmark/causalGraphBenchmark.ts`：补充高连接度枢纽基准。
- `packages/contracts/src/relations/relationSchemas.ts`：关系案例选择上限。
- `apps/api/src/features/relations/relationRepository.ts`：新案例批量写入。
- `apps/api/src/features/events/eventRepository.ts`：读取、写入和索引搜索规范化关键词。
- `apps/api/src/database/schema/abstractEvents.ts`：移除迁移后的关键词数组定义。
- `apps/web/src/features/{events,cases,relations,causal-graph}/api/*.ts`：复用共享 HTTP 客户端。
- `apps/web/src/features/causal-graph/pages/CausalGraphPage.tsx`：移除重复中心事件详情请求。
- `apps/web/src/shared/candidates/useExhaustiveCandidates.ts`：收敛查询键和去重函数接口。
- `apps/api/src/database/test-data/simulate.ts`：在首次生成案例关联时累计计数。
- `apps/web/src/styles/global.css`：移除旧页面壳和 Hero 死样式。
- `apps/web/package.json`、`pnpm-lock.yaml`：删除未直接使用的 `elkjs@0.12.0`。
- `tests/production/production-smoke.spec.ts`：按最终图工作台结构验证生产页面。
- `README.md`：完整重写为 GitHub 正式版本说明。

### 保留但不在本轮重写

- `docs/stages/**` 和既有实施计划作为项目历史记录继续保留，但不再从 README 面向普通使用者展示。
- Cytoscape/ELK 仍作为图渲染和布局实现；Web Worker、布局引擎替换和进一步减包进入 README Roadmap。

---

### Task 1: 修复生产门禁与案例详情分页

**Files:**

- Modify: `tests/production/production-smoke.spec.ts`
- Modify: `apps/web/src/features/cases/pages/CaseDetailPage.tsx`
- Modify: `apps/web/src/features/cases/pages/CasePages.test.tsx`
- Modify: `tests/e2e/cases.spec.ts`

**Interfaces:**

- Consumes: `getCaseRelations(id, { cursor, limit }, signal): Promise<CaseRelationListResponse>`。
- Produces: 案例详情首批 30 条、显式加载下一批、无遗漏浏览；生产烟雾测试使用稳定的工作台可访问名称。

- [ ] **Step 1: 写案例详情分页失败测试**

在 `CasePages.test.tsx` 模拟第一页 `hasMore: true`、第二页 `hasMore: false`，验证首屏只显示第一页，点击“加载更多”后合并第二页，并按关系 `id` 去重。固定查询配置为：

```ts
useInfiniteQuery({
  queryKey: ['cases', 'relations', caseId],
  initialPageParam: undefined as string | undefined,
  queryFn: ({ pageParam, signal }) =>
    getCaseRelations(caseId, { limit: 30, ...(pageParam ? { cursor: pageParam } : {}) }, signal),
  getNextPageParam: (page) => (page.hasMore ? (page.nextCursor ?? undefined) : undefined),
  enabled: Boolean(caseId),
  retry: false,
});
```

- [ ] **Step 2: 运行局部测试并确认旧实现失败**

Run: `pnpm --filter @causality/web test -- CasePages.test.tsx`

Expected: FAIL，旧页面不存在“加载更多”且不会请求第二个游标。

- [ ] **Step 3: 实现显式加载和稳定状态**

将 `CaseDetailPage` 改用 `useInfiniteQuery`。渲染行为固定为：

- 初次加载显示“加载关联关系…”；
- 首次失败显示现有错误区；
- 已有数据时继续保留列表；
- `hasNextPage` 时显示右对齐“加载更多”；
- 加载下一页时按钮文案为“加载中…”并禁用；
- 下一页失败时保留已加载内容并显示可重试按钮；
- 列表键和去重键均使用关系 `id`。

- [ ] **Step 4: 修正生产烟雾测试的稳定定位**

把旧标题断言：

```ts
page.getByRole('heading', { name: '局部因果图' })
```

替换为最终页面已有的区域断言：

```ts
await expect(page.getByRole('region', { name: '局部因果图工作台' })).toBeVisible();
```

不得为迎合测试恢复已被最终设计移除的页面标题。

- [ ] **Step 5: 增加真实浏览器超过 30 条的回归场景**

在 `tests/e2e/cases.spec.ts` 创建或通过 API 准备 31 条关系关联到同一案例，验证详情首批为 30、点击后第 31 条可见且总数不变。

- [ ] **Step 6: 运行任务门禁**

Run:

```bash
pnpm --filter @causality/web test -- CasePages.test.tsx
pnpm test:e2e
pnpm test:production
```

Expected: Web 局部测试、14 项以上源码 E2E 和 1 项生产烟雾测试全部通过。

- [ ] **Step 7: 提交独立修复**

```bash
git add apps/web/src/features/cases/pages/CaseDetailPage.tsx apps/web/src/features/cases/pages/CasePages.test.tsx tests/e2e/cases.spec.ts tests/production/production-smoke.spec.ts
git commit -m "fix: complete case relation pagination and production smoke"
```

---

### Task 2: 用 SQL 节点预算约束局部图遍历

**Files:**

- Modify: `apps/api/src/features/causal-graph/causalGraphTypes.ts`
- Modify: `apps/api/src/features/causal-graph/causalGraphRepository.ts`
- Modify: `apps/api/src/features/causal-graph/causalGraphService.ts`
- Modify: `apps/api/test/causal-graph-service.test.ts`
- Modify: `apps/api/test/causal-graph.integration.test.ts`
- Modify: `apps/api/src/database/benchmark/causalGraphBenchmark.ts`
- Modify: `apps/api/test/causal-graph-benchmark.test.ts`

**Interfaces:**

- Replaces: `findAdjacentRelations(eventIds, direction, filters)`。
- Produces:

```ts
findAdjacentEventIds(
  frontierIds: string[],
  visitedIds: string[],
  direction: CausalGraphQuery['direction'],
  filters: CausalGraphFilters,
  limit: number,
): Promise<string[]>;
```

- [ ] **Step 1: 写 Service 预算失败测试**

扩展 Memory Repository，记录每次收到的 `limit`。构造多层图并验证：20 档第一层收到 20；第一层发现 12 个节点后第二层只收到 8；达到上限后不再调用下一层；循环和反向关系不会重复发现节点。

- [ ] **Step 2: 写 PostgreSQL 高出度集成失败测试**

创建一个中心事件及至少 1,500 个相邻事件，执行 `limit=20`，验证 Repository 只返回 20 个相邻事件，并继续验证最终图节点、关系、排序和 `stopReason` 与现有契约一致。

- [ ] **Step 3: 实现有限量的相邻事件 SQL**

Repository SQL 必须完成以下工作后再返回：

1. 按方向把关系转换成一个 `neighbor_id`；
2. 排除 `visitedIds`；
3. 聚合案例数并应用置信度、案例数筛选；
4. 同一邻居存在正反两条关系时只保留排序最靠前的一条；
5. 按 `confidence desc, case_count desc, relation_id asc, neighbor_id asc` 排序；
6. 最后执行参数化 `LIMIT`。

SQL 结构固定为：

```sql
with adjacent as (...),
ranked as (
  select neighbor_id,
         row_number() over (
           partition by neighbor_id
           order by confidence desc, case_count desc, relation_id asc
         ) as neighbor_rank,
         confidence,
         case_count,
         relation_id
  from adjacent
  where not (neighbor_id = any($2::uuid[]))
)
select neighbor_id
from ranked
where neighbor_rank = 1
order by confidence desc, case_count desc, relation_id asc, neighbor_id asc
limit $5;
```

方向分支必须使用参数化数组，不拼接用户输入；允许拼接的仅是由已验证枚举选择出的静态 SQL 片段。

- [ ] **Step 4: 简化 Service 遍历**

每层计算：

```ts
const remaining = query.limit - (nodes.length - 1);
const nextIds = await snapshot.findAdjacentEventIds(
  frontier,
  [...visited],
  query.direction,
  filters,
  remaining,
);
```

随后一次批量读取事件、更新 `visited` 和 `frontier`。返回数量等于 `remaining` 时设置 `node_limit` 并停止；不为判断“是否还有更多”执行额外查询。

- [ ] **Step 5: 加强性能基准的枢纽数据**

在随机模拟数据后，通过同一事务把一个专用中心连接到 10,000 个不同事件，同时删除等量随机关系，使总关系数保持 500,000。基准报告新增：

```ts
{ name: 'hub', degree: 10_000 }
```

枢纽场景至少覆盖 `both + limit=20`、`both + limit=100` 和组合筛选，并纳入同一个 P95 2 秒门槛。

- [ ] **Step 6: 运行任务门禁**

Run:

```bash
pnpm --filter @causality/api test -- causal-graph-service.test.ts
pnpm test:integration
pnpm graph:benchmark
```

Expected: Service、50 项以上集成测试通过；基准数据包含 degree 10,000 的 hub，整体 P95 不超过 2,000ms。

- [ ] **Step 7: 提交查询成本修复**

```bash
git add apps/api/src/features/causal-graph apps/api/test/causal-graph-service.test.ts apps/api/test/causal-graph.integration.test.ts apps/api/src/database/benchmark
git commit -m "perf(api): bound causal graph traversal in SQL"
```

---

### Task 3: 限制并批量处理关系案例写入

**Files:**

- Modify: `packages/contracts/src/relations/relationSchemas.ts`
- Modify: `packages/contracts/test/relations.test.ts`
- Modify: `apps/api/src/features/relations/relationRepository.ts`
- Modify: `apps/api/test/relations.integration.test.ts`
- Modify: `apps/web/src/features/relations/components/RelationForm.tsx`
- Modify: `apps/web/src/features/relations/components/RelationForm.test.tsx`

**Interfaces:**

- Produces: `relationFormInputSchema.caseSelections.max(1_000, '单条因果关系最多关联 1000 条具体案例')`。
- Preserves: 已有案例与新案例可以混合提交；内容冲突仍返回现有案例 ID；整个写入仍在同一事务中原子完成。

- [ ] **Step 1: 写契约边界失败测试**

验证 1,000 条选择可以解析，1,001 条选择返回 `caseSelections` 路径的验证错误，重复已有 ID和重复新案例内容仍被拒绝。

- [ ] **Step 2: 写 Repository 批量和回滚失败测试**

一次提交多个新案例和已有案例；验证全部案例只关联一次。再提交一个已存在内容混在多个新内容中的请求，验证返回内容冲突并且该事务没有留下任何部分创建的新案例。

- [ ] **Step 3: 实现批量写入**

用一次 SQL 写入全部新内容：

```sql
insert into concrete_cases (content)
select content
from unnest($1::text[]) as selected(content)
on conflict (content) do nothing
returning id, content;
```

如果返回数量少于新内容数量，用一次 `where content = any($1::text[])` 查询冲突记录并抛出 `RelationCaseContentConflictError`；事务回滚后不得遗留本次其他新案例。现有关联删除和 `unnest(uuid[])` 批量插入继续保留。

- [ ] **Step 4: 在表单提供明确边界**

达到 1,000 行后禁用“添加案例”，并在原有字段错误位置显示“单条因果关系最多关联 1000 条具体案例”。不增加新的弹窗或后台拆单行为。

- [ ] **Step 5: 运行任务门禁**

Run:

```bash
pnpm --filter @causality/contracts test -- relations.test.ts
pnpm --filter @causality/web test -- RelationForm.test.tsx
pnpm test:integration
```

Expected: 1,000/1,001 边界、批量写入、冲突回滚和表单禁用测试全部通过。

- [ ] **Step 6: 提交写入优化**

```bash
git add packages/contracts/src/relations apps/api/src/features/relations/relationRepository.ts apps/api/test/relations.integration.test.ts apps/web/src/features/relations/components
git commit -m "perf: batch and bound relation case writes"
```

---

### Task 4: 将事件关键词规范化为可索引搜索数据

**Files:**

- Create: `apps/api/src/database/schema/eventKeywords.ts`
- Create: `database/migrations/0005_event_keywords.sql`
- Modify: `apps/api/src/database/schema/abstractEvents.ts`
- Modify: `apps/api/src/database/schema/index.ts`
- Modify: `apps/api/src/features/events/eventRepository.ts`
- Modify: `apps/api/test/events.integration.test.ts`
- Modify: `apps/api/test/core-model.integration.test.ts`
- Modify: `apps/api/src/database/test-data/fixedSeed.ts`
- Modify: `apps/api/src/database/test-data/simulate.ts`
- Modify: `apps/api/src/database/verify.ts`

**Interfaces:**

- Preserves: REST 输入输出中的 `keywords: string[]` 不变。
- Produces: `event_keywords(event_id, keyword, normalized_keyword)`，规范化关键词具备 trigram GIN 索引。

- [ ] **Step 1: 写迁移和搜索失败测试**

测试迁移前数组关键词被逐项无损复制；迁移后事件详情和列表仍返回同样顺序；使用关键词子串可以命中；直接插入空白、51 字或同事件重复规范化关键词会被数据库拒绝。

- [ ] **Step 2: 定义关键词表**

Drizzle 表结构固定为：

```ts
export const eventKeywords = pgTable(
  'event_keywords',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => abstractEvents.id, { onDelete: 'cascade' }),
    keyword: varchar('keyword', { length: 50 }).notNull(),
    normalizedKeyword: varchar('normalized_keyword', { length: 50 })
      .generatedAlwaysAs(sql`lower(btrim(keyword))`)
      .notNull(),
    position: integer('position').notNull(),
  },
  (table) => [
    uniqueIndex('event_keywords_event_normalized_uidx').on(
      table.eventId,
      table.normalizedKeyword,
    ),
    uniqueIndex('event_keywords_event_position_uidx').on(table.eventId, table.position),
    index('event_keywords_normalized_trgm_idx').using(
      'gin',
      table.normalizedKeyword.op('gin_trgm_ops'),
    ),
    index('event_keywords_event_id_idx').on(table.eventId),
    check('event_keywords_length_check', sql`char_length(btrim(${table.keyword})) between 1 and 50`),
  ],
);
```

- [ ] **Step 3: 编写无损迁移**

迁移顺序必须是：创建表和索引；`unnest(keywords) with ordinality` 把原数组序号写入 `position`；核对复制数量；最后移除 `abstract_events.keywords`。迁移任何一步失败都由 PostgreSQL 事务回滚。

- [ ] **Step 4: 更新 Event Repository**

新增 `loadKeywords(eventIds)` 和 `replaceKeywords(client, eventId, keywords)`；读取按 `event_id, position` 排序，创建和编辑通过 `unnest($2::text[]) with ordinality` 在同一事务批量写入。搜索 CTE 的关键词分支改为直接查询：

```sql
select k.event_id,
       case when k.normalized_keyword = $1 then 5 else 6 end as rank
from event_keywords k
where k.normalized_keyword like $3 escape '\\'
```

列表、详情和候选响应结构保持不变。

- [ ] **Step 5: 更新种子、模拟和完整性验证**

固定种子与模拟数据分别批量写入 `event_keywords`；`db:verify` 增加孤立关键词、重复规范化关键词和非法长度检查，但继续输出对用户有意义的事件总数，不把关键词数混入事件数。

- [ ] **Step 6: 运行数据库门禁**

Run:

```bash
pnpm typecheck
pnpm test:integration
pnpm db:migrate
pnpm db:verify
```

Expected: 迁移可重复执行，现有开发数据关键词数量和内容保持不变，所有数据库完整性指标为 0，`valid` 为 `true`。

- [ ] **Step 7: 提交索引化关键词**

```bash
git add apps/api/src/database apps/api/src/features/events apps/api/test database/migrations
git commit -m "perf(db): index normalized event keywords"
```

---

### Task 5: 收敛前端数据访问与关联详情加载策略

**Files:**

- Create: `apps/web/src/shared/api/httpClient.ts`
- Create: `apps/web/src/shared/api/httpClient.test.ts`
- Modify: `apps/web/src/features/events/api/eventApi.ts`
- Modify: `apps/web/src/features/cases/api/caseApi.ts`
- Modify: `apps/web/src/features/relations/api/relationApi.ts`
- Modify: `apps/web/src/features/causal-graph/api/causalGraphApi.ts`
- Modify: `apps/web/src/features/causal-graph/pages/CausalGraphPage.tsx`
- Modify: `apps/web/src/features/causal-graph/pages/CausalGraphPage.test.tsx`
- Modify: `apps/web/src/features/relations/pages/RelationDetailPage.tsx`
- Modify: `apps/web/src/features/relations/pages/RelationDetailPage.test.tsx`
- Modify: `apps/web/src/shared/candidates/useExhaustiveCandidates.ts`
- Modify: `apps/web/src/shared/candidates/useExhaustiveCandidates.test.tsx`
- Modify: `apps/web/src/features/causal-graph/components/GraphEventSelector.tsx`
- Modify: `apps/web/src/features/relations/components/EventSelector.tsx`
- Modify: `apps/web/src/features/relations/components/CaseSelectorRow.tsx`

**Interfaces:**

- Produces:

```ts
export class ApiClientError extends Error {
  constructor(readonly details: ApiError);
}

export async function requestJson(
  url: string,
  options?: RequestInit,
  signal?: AbortSignal,
  timeoutMilliseconds?: number,
): Promise<unknown>;
```

- Changes: `useExhaustiveCandidates<T extends { id: string }>` 接受不包含搜索词的基础 `queryKey`，由 Hook 只追加一次 `query`，并直接使用 `item.id` 去重，不再接收 `getId`。

- [ ] **Step 1: 写共享 HTTP 客户端失败测试**

覆盖 2xx JSON、API 标准错误、非标准错误回退、调用方取消、10 秒超时、请求体自动增加 JSON Header，以及无请求体不增加 Content-Type。

- [ ] **Step 2: 实现并迁移四个业务 API**

事件、案例、关系和因果图全部调用 `requestJson`，各模块只负责 URL、请求方法、负载和 Zod 响应解析。`ApiClientError` 只从 `shared/api/httpClient` 导入，消除案例、关系和图模块对事件 API 的反向依赖。系统状态 API 保留 5 秒超时和 503 readiness 的特殊语义，不强制套用业务错误解析。

- [ ] **Step 3: 关系详情改成显式加载案例**

保留 `useInfiniteQuery`，删除自动调用 `fetchNextPage` 的 Effect。首批固定 100 条，存在下一页时显示“加载更多”；下一页失败保留已有列表并允许重试。不得一次渲染未请求的案例。

- [ ] **Step 4: 移除图页重复中心事件请求**

中心选择名称的优先级改为：用户刚选择的候选；当前成功图中的中心节点；加载 URL 时临时显示“中心事件”。事件不存在和网络错误统一由图查询返回，重试只调用 `graphQuery.refetch()`。删除 `getEvent` 查询和非标准 `['events', 'detail', 'causal-graph', id]` 缓存键。

- [ ] **Step 5: 修正候选 Hook 的重复工作**

调用方 query key 改成：

```ts
['events', 'candidates', 'graph-selector']
['events', 'candidates', 'relation-selector']
['cases', 'candidates']
```

Hook 内保留唯一一次 `queryKey: [...queryKey, query]`。对标准 `{ id: string }` 数据直接以 `item.id` 去重，避免调用方每次渲染创建新的 `getId` 导致全列表重新映射。

- [ ] **Step 6: 运行前端门禁**

Run:

```bash
pnpm --filter @causality/web test
pnpm typecheck
pnpm test:e2e
```

Expected: Web 全量测试和源码 E2E 全部通过；直接打开带中心事件 URL、切换参数、关系详情加载更多行为不变或符合新分页规则。

- [ ] **Step 7: 提交前端收敛**

```bash
git add apps/web/src/shared apps/web/src/features
git commit -m "refactor(web): centralize API access and paged detail loading"
```

---

### Task 6: 清理后端重复基础设施、模拟内存和死资源

**Files:**

- Create: `apps/api/src/features/shared/sqlSearch.ts`
- Create: `apps/api/test/support/integrationGlobalSetup.ts`
- Create: `apps/api/test/support/postgresTestContext.ts`
- Modify: `apps/api/src/features/events/eventRepository.ts`
- Modify: `apps/api/src/features/cases/caseRepository.ts`
- Modify: `apps/api/src/features/relations/relationRepository.ts`
- Modify: `apps/api/src/features/{events,cases,relations}/*Cursor.ts`
- Modify: `apps/api/test/*.integration.test.ts`
- Modify: `apps/api/vitest.integration.config.ts`
- Modify: `apps/api/src/database/test-data/simulate.ts`
- Modify: `apps/api/test/simulation.test.ts`
- Modify: `apps/web/src/styles/global.css`
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Produces:

```ts
export function normalizeSearchQuery(query: string): string;
export function escapeLikePattern(value: string): string;

export async function startPostgresTestContext(databaseName: string): Promise<{
  pool: Pool;
  app: ReturnType<typeof buildApp>;
  close(): Promise<void>;
}>;
```

- [ ] **Step 1: 为共享 SQL 搜索工具写单元测试**

覆盖首尾空白、中文、大小写、反斜线、百分号和下划线。三个 Repository 和三个 Cursor 必须使用同一规范化函数；Cursor 的业务字段编码仍留在各自模块。

- [ ] **Step 2: 提取集成测试全局容器和隔离数据库上下文**

`integrationGlobalSetup.ts` 统一启动一个 `postgres:18.4-alpine` 容器，使用 Vitest `project.provide` 把主机、映射端口、用户和密码提供给测试进程，并在全局 teardown 停止容器。`postgresTestContext.ts` 为每个测试文件创建名称固定且受白名单校验的独立数据库，执行迁移、创建连接池和 Fastify app；局部 `close()` 逆序关闭 app 和连接池。`vitest.integration.config.ts` 注册 global setup 并继续保持 `fileParallelism: false`，因此一次 `pnpm test:integration` 只有一个容器，同时各套件数据完全隔离。

- [ ] **Step 3: 消除模拟数据第二次物化**

在首次循环内累计：

```ts
let caseLinkCount = 0;
for (const link of plan.caseLinks()) {
  caseLinkCount += 1;
  // existing batch insert
}
```

返回 `caseLinks: caseLinkCount`，删除 `Array.from(plan.caseLinks()).length`。增加 0、默认 10,000 和最大值生成器的纯逻辑计数测试，不在单元测试真正插入百万行。

- [ ] **Step 4: 删除确定无引用的资源**

从 `global.css` 删除 `.app-shell`、`.app-header`、`.brand`、`.brand-mark`、`.environment-label`、旧全局 `main` 两栏布局、`.hero` 及其子选择器；保留系统状态页仍使用的 `.eyebrow` 和 `.status-*`。从 Web 依赖删除没有源码引用的直接 `elkjs@0.12.0`；保留 `cytoscape-elk` 自带并实际使用的 ELK 依赖。

- [ ] **Step 5: 验证没有误删和资源竞争**

Run:

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
```

Expected: 全部门禁通过；普通页面、系统状态页和因果图样式不变；生产构建仍保持图路由懒加载。

- [ ] **Step 6: 提交清理**

```bash
git add apps/api apps/web/src/styles/global.css apps/web/package.json pnpm-lock.yaml
git commit -m "refactor: remove duplicated infrastructure and dead resources"
```

---

### Task 7: 为三个主列表增加完整页码导航

**Files:**

- Create: `packages/contracts/src/pagination/pageSchemas.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/events/eventSchemas.ts`
- Modify: `packages/contracts/src/cases/caseSchemas.ts`
- Modify: `packages/contracts/src/relations/relationSchemas.ts`
- Modify: `packages/contracts/test/{events,cases,relations}.test.ts`
- Create: `apps/api/src/features/shared/pagePagination.ts`
- Modify: `apps/api/src/features/{events,cases,relations}/*Repository.ts`
- Modify: `apps/api/src/features/relations/relationRoutes.ts`
- Modify: `apps/api/test/{events,cases,relations}.integration.test.ts`
- Create: `apps/web/src/shared/pagination/ListPagination.tsx`
- Create: `apps/web/src/shared/pagination/ListPagination.test.tsx`
- Modify: `apps/web/src/features/{events,cases,relations}/api/*.ts`
- Modify: `apps/web/src/features/events/pages/EventListPage.tsx`
- Modify: `apps/web/src/features/cases/pages/CaseListPage.tsx`
- Modify: `apps/web/src/features/relations/pages/RelationListPage.tsx`
- Modify: `apps/web/src/features/relations/pages/{RelationDetailPage,RelationEditPage}.tsx`
- Modify: `apps/web/src/features/events/pages/EventListPage.test.tsx`
- Modify: `apps/web/src/features/cases/pages/CasePages.test.tsx`
- Modify: `apps/web/src/features/relations/pages/RelationListPage.test.tsx`
- Modify: `apps/web/src/features/relations/pages/{RelationDetailPage,RelationEditPage}.test.tsx`
- Modify: `apps/web/src/styles/events.css`
- Modify: `tests/e2e/{events,cases,relations}.spec.ts`

**Interfaces:**

- 三个主列表查询统一使用：

```ts
{
  q: string;
  page: number; // default 1, min 1, max 100_000
  limit: number; // default 30, min 1, max 100
}
```

- 案例列表继续额外支持 `relationId?: string`。
- 三个主列表响应统一为：

```ts
{
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number; // 即使没有结果也至少为 1
}
```

- 主列表不再返回 `nextCursor` 和 `hasMore`。候选接口、案例详情关系接口和关系详情案例接口的游标契约保持不变。
- 为避免关系详情复用已改为页码契约的案例主列表，新增内部接口
  `GET /api/relations/:relationId/cases`；查询为
  `{ limit: number /* default 100 */, cursor?: string }`，响应继续为
  `{ items: CaseSummary[], nextCursor: string | null, hasMore: boolean }`，且游标绑定
  `relationId`。关系详情与关系编辑页改用此接口，维持每批 100 条的“加载更多”行为。
- Produces:

```ts
export interface ListPaginationProps {
  page: number;
  totalPages: number;
  totalItems: number;
  disabled?: boolean;
  onPageChange(page: number): void;
}
```

- [ ] **Step 1: 先写主列表页码契约失败测试**

三个主列表 Query 测试固定验证：默认 `page=1`、默认 `limit=30`、拒绝 `page=0`、负数、小数和大于 `100_000` 的页码；主列表 Response 必须包含 `page/pageSize/totalItems/totalPages`，且不再接受 `nextCursor/hasMore`。候选和详情分页测试继续验证原游标结构。

- [ ] **Step 2: 运行 Contracts 测试并确认旧契约失败**

Run: `pnpm --filter @causality/contracts test`

Expected: FAIL，旧主列表只接受 `cursor`，响应没有页码和总数元数据。

- [ ] **Step 3: 写三个 Repository 的页码与总数失败测试**

每个资源至少准备 `31` 条记录并验证：第一页 `30` 条、第二页剩余 `1` 条、`totalItems=31`、`totalPages=2`；搜索结果的总数只统计匹配项；案例 `relationId` 筛选总数只统计关联案例；请求超过最后一页时 Repository 把有效页钳制到最后一页。排序必须保持当前确定性规则，不因改成 OFFSET 而变化。

- [ ] **Step 4: 实现主列表页码 SQL**

三个 Repository 先用与数据查询完全相同的筛选条件得到 `totalItems`，再计算：

```ts
const totalPages = Math.max(1, Math.ceil(totalItems / query.limit));
const page = Math.min(query.page, totalPages);
const offset = (page - 1) * query.limit;
```

随后使用参数化 `LIMIT`/`OFFSET` 读取当前页。搜索 CTE、别名/关键词匹配、关系案例计数和案例关系筛选语义保持不变。禁止为了得到某页而顺序读取前面所有游标；不得将 `page` 或 `offset` 拼接进 SQL。

- [ ] **Step 5: 实现紧凑的共享页码组件**

组件始终显示：`共 N 条 · 第 P/T 页`、上一页、下一页、页码按钮和 `跳至 [输入框] 页`。页码规则固定为首页、末页和当前页前后各 `2` 页，缺口用不可点击省略号表示；当前页使用 `aria-current="page"`。上一页/下一页在边界禁用。跳转输入只接受整数 `1..totalPages`，按 Enter 或点击“跳转”执行；空值和非法值不改变页面。组件不发请求，只调用 `onPageChange`。

- [ ] **Step 6: 将三个列表页改为 URL 页码状态**

三个列表从 `page` 查询参数读取当前页，缺失或非法时使用 `1`。搜索词或案例 `relationId` 筛选发生变化时删除 `page` 并回到第 `1` 页；翻页和跳转写入 URL，因此刷新、浏览器前进/后退能恢复页面。关系列表切换页码时继续清除 `expanded`。Query Key 必须包含 `page`，API 请求发送 `page` 和固定 `limit=30`，删除三个页面的 `cursorStack`。

当后端因总数变化把页码钳制到最后一页时，页面使用 `replace` 把响应中的有效页同步回 URL，不产生历史记录循环。加载新页时保留现有表格直到新数据返回，分页控件在请求中禁用，避免重复跳转。

- [ ] **Step 7: 增加组件、页面和真实浏览器回归测试**

组件测试覆盖少于 `7` 页、很多页的省略号、边界禁用、当前页、点击页码、合法/非法输入跳转。三个页面测试覆盖总数信息、下一页、上一页、点击具体页码、输入任意页、搜索后回第一页、浏览器 URL 页码恢复；关系页面额外验证翻页后详情收起。E2E 为三个资源各准备至少 `31` 条可识别记录，验证第一页/第二页及总数信息；事件 E2E 额外准备超过 `210` 条记录，验证从第一页直接跳至第 `8` 页而不顺序请求中间页。

- [ ] **Step 8: 运行任务门禁**

Run:

```bash
pnpm --filter @causality/contracts test
pnpm --filter @causality/api test
pnpm --filter @causality/web test
pnpm test:integration
pnpm typecheck
pnpm test:e2e
```

Expected: Contracts、API、Web、集成和 E2E 全部通过；三个主列表均能直接跳页，候选和详情“加载更多”行为不变。

- [ ] **Step 9: 提交主列表分页功能**

```bash
git add packages/contracts apps/api apps/web tests/e2e
git commit -m "feat: add numbered pagination to resource lists"
```

---

### Task 8: 重写正式 README、记录 Roadmap 并完成发布候选验证

**Files:**

- Rewrite: `README.md`
- Modify: `docs/superpowers/plans/2026-07-22-phase-1-release-remediation.md`
- Verify only: `package.json`
- Verify only: `compose.yaml`
- Verify only: `compose.dev.yaml`
- Verify only: `apps/api/.env.example`

**Interfaces:**

- Produces: 面向 GitHub 使用者的 `v0.1.0` 正式项目主页和一套没有失败项的发布门禁结果。
- Does not produce: GitHub Actions、Release 页面、许可证、远程推送或 Git tag；这些外部动作必须在用户人工复核后另行授权。

- [ ] **Step 1: 按正式产品结构完整重写 README**

README 只保留以下章节和顺序：

1. `Causality`：一句话说明这是用于人工维护原子事件、因果关系和真实案例的本地金融因果知识库。
2. `核心能力`：事件与多别名/关键词、带置信度的有向关系、可复用真实案例、局部因果图、传统搜索。
3. `快速开始`：Docker 要求、`docker compose up -d --build --wait`、访问 `http://127.0.0.1:8080`。
4. `数据与持久化`：空库启动、显式示例种子、命名卷、停止和危险重置。
5. `使用说明`：分别简述事件、关系、案例和局部图操作；说明三个主列表每页 30 条并支持页码和直接跳转；案例上限写 100 字；图参数变化按最终实现描述。
6. `配置`：`CAUSALITY_WEB_PORT`、`CAUSALITY_LOG_LEVEL` 和 Docker Context 行为。
7. `源码开发`：准确的安装、环境文件、开发 PostgreSQL 和 `pnpm dev` 命令。
8. `API`：仅列资源和入口，不重复完整 OpenAPI Schema；说明 `/api/health` 是进程存活、`/api/ready` 是数据库就绪。
9. `质量验证`：列出可执行命令，不写容易过期的测试数量和阶段状态。
10. `当前限制`：本机单用户、无认证、无删除/审计、人工置信度、最多 100 个关联节点、不保证公网部署安全。
11. `Roadmap`：只列后续方向，不承诺时间。

README Roadmap 固定为：

- 数据质量、修改历史、软删除和恢复；
- CSV/JSON 批量导入与人工审核；
- 传统搜索性能、排序和可观测性增强；
- 可选语义搜索与 pgvector 评估；
- Cytoscape/ELK Web Worker、图页面资源体积和布局性能优化；
- 多段因果路径和历史案例分析；
- 备份恢复、监控、安全响应头和按需认证。

README 不出现以下内容：`P1-01`、`P1-10`、`UX-01`、`等待人工复核`、历史测试项数量、内部设计文档路径、未经确认的 GitHub 地址、徽章、许可证声明或自动发布承诺。

- [ ] **Step 2: 核对 README 中的每条命令和事实**

逐项对照根 `package.json`、Compose 文件和 `.env.example`。执行 README 的生产启动、开发启动、显式种子、停止和质量检查命令；危险重置命令只核对文本，不对开发数据卷执行。

- [ ] **Step 3: 执行全量发布候选门禁**

按顺序执行，避免同时竞争 Docker 资源：

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm test:compose
pnpm graph:benchmark
pnpm test:production
pnpm build
git diff --check
git status --short
```

Expected:

- 所有命令退出码为 0；
- 源码 E2E 和生产冒烟没有跳过项；
- 高连接度枢纽纳入图基准且 P95 不超过 2 秒；
- 构建中图模块仍为懒加载；大体积警告记录为 Roadmap，不通过提高警告阈值隐藏；
- 工作区只包含本整改计划批准的文件变化。

- [ ] **Step 4: 进行桌面端人工复核**

用户在至少 1280×720 下复核：三个主列表的总条目数、当前/总页数、页码按钮、上一页/下一页和任意页跳转；案例详情加载第 31 条关系；关系详情加载第二批案例；图页面直接 URL 恢复、20/50/100 节点、方向和筛选；事件关键词搜索；关系一次关联多条新案例；系统状态；生产容器重启后数据持久化。

- [ ] **Step 5: 记录最终验证但不污染 README**

把实际命令结果和用户人工复核日期写入本计划末尾的“执行记录”，README 只保留稳定的验证命令。未获得用户明确确认前，不标记计划完成、不创建 tag、不推送 GitHub。

- [ ] **Step 6: 提交正式文档**

```bash
git add README.md docs/superpowers/plans/2026-07-22-phase-1-release-remediation.md
git commit -m "docs: prepare v0.1.0 GitHub release documentation"
```

---

## 2. 审核与实施顺序

必须依次执行，不并行跨越用户审核点：

1. Task 1：先恢复真实发布门禁并修复用户不可见数据；
2. Task 2：修复局部图查询成本边界；
3. Task 3：修复关系案例无界串行写入；
4. Task 4：完成关键词索引迁移；
5. Task 5：统一前端数据访问和详情分页；
6. Task 6：清理重复基础设施、死代码和无效依赖；
7. Task 7：为事件、关系和案例主列表增加完整页码导航；
8. Task 8：重写 README、执行全部门禁和人工复核。

每个 Task 完成局部自动化后先报告结果；涉及页面的 Task 1、Task 5、Task 7 和最终 Task 8 必须提供人工复核路径。任何一步失败都停留在该步修复，不带着已知失败进入下一步。

## 3. 明确不在本轮解决的 Roadmap 项

以下内容不是遗漏，而是需要独立设计和真实数据验证的后续工作：

- 将 ELK 布局移动到 Web Worker，并基于网络瀑布和交互延迟决定是否替换或拆分布局依赖；
- 语义搜索、pgvector 和嵌入模型；
- 完整因果路径推理、利好/利空结果推断；
- 数据导入、备份恢复、认证授权和公网安全部署。

本轮只保证大图运行时代码继续按图路由懒加载，并删除没有被使用的直接 `elkjs` 依赖；不通过调高 Vite 警告阈值伪装资源体积已经下降。

## 4. 计划自检

- 审计中的生产烟雾、案例详情遗漏、图查询无界、关系案例串行写入、关键词搜索、关系详情全量读取、重复 HTTP、重复 SQL 工具、重复集成环境、模拟内存、死 CSS、无效依赖、重复候选键、重复中心请求、README 过期和图包 Roadmap 均有对应任务。
- 数据库迁移不修改历史迁移；仅三个主列表 API 按新增需求从游标响应切换为页码响应，候选和详情分页 API 保持兼容。
- 所有新增限制、分页批次和性能边界都有明确数值和测试位置。
- README 重写范围不包含内部开发流水账，也不声明仓库当前不存在的许可证、CI 或远程地址。
- 计划不包含未定义占位项；实施结束条件是自动化全部通过并获得用户人工复核确认。

## 5. 执行记录

当前状态：等待方案审核。

审计基线（2026-07-22）：格式、Lint、类型、229 项单元/组件测试、50 项独立集成测试、14 项源码 E2E、2 项 Compose 合约、生产构建和局部图随机分布基准通过；生产容器健康，但生产烟雾因旧图标题断言失败。该基线仅保存在实施计划中，不写入正式 README。
