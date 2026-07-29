# P3-01R1 Task 4 只读查询与证据工具 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 为 Causality 新增具体案例详情、因果关系搜索、受限有向路径和因果证据包四个只读 MCP 工具，使外部 AI 能够用数据库中的关系与案例形成可核对的分析依据。

**Architecture:** Contracts 定义路径和证据包的唯一 API 契约；API 新增 causal-evidence 深模块，在 PostgreSQL 只读快照中按层批量读取邻接边并组装证据包。MCP 新建独立 registerEvidenceTools 模块，复用现有案例/关系 API，并通过 CausalityApiClient 调用新增路径与证据 API；MCP 不自行计算路径或修改服务端事实。

**Tech Stack:** Node.js 24.18.0、pnpm 11.15.1、TypeScript 6.0.2、Fastify 5.10.0、PostgreSQL 18、Zod 4.4.3、@modelcontextprotocol/sdk 1.30.0、Vitest 4.1.10、Testcontainers。

## Global Constraints

- 严格实现 docs/superpowers/specs/2026-07-30-p3-01r1-task4-readonly-query-evidence-tools-design.md，不得扩展到 Task 5 的分析 Prompt 或 Resource。
- 保持现有 11 个 MCP 工具完全兼容；新增 4 个工具后总数固定为 15。
- 新工具名称固定为 get_concrete_case、search_causal_relations、find_causal_paths、get_causal_evidence_bundle。
- 所有新工具必须标记为只读、非破坏、幂等、openWorldHint: false。
- 路径只沿真实 causeEvent → effectEvent 方向查询；最大深度 10、最多返回 10 条路径、最多扩展 10,000 个候选状态。
- 普通关系搜索为默认值；增强搜索只能显式请求，失败时不得静默降级。
- 证据包只接收 1–10 个有序关系 ID，每条关系默认返回 5 条、最多 20 条案例。
- 不新增数据库业务表、不加载整张图到 Node.js 内存、不增加通用写权限。
- API 是路径、连续性、截断状态和错误分类的唯一信任边界；MCP 只镜像结构和生成可读摘要。
- 每个任务严格执行 RED → GREEN → 重构 → 聚焦验证 → 独立代码审查 → 本地提交；不得推送 GitHub。
- 保留用户现有未提交路径：.gitignore、README.md、docs/user-guide.md、research/、docs/superpowers/specs/2026-07-29-p3-01r1-task2-unified-capture-policy-v2-prompt-design.md，除非用户另行授权。

## File Structure

### Contracts

- Create packages/contracts/src/causal-evidence/causalEvidenceSchemas.ts：路径查询、路径结果、证据包输入输出和截断原因的唯一契约。
- Create packages/contracts/test/causal-evidence.test.ts：默认值、上下限、严格对象和跨字段约束。
- Modify packages/contracts/src/index.ts：导出所有新 Schema 与类型。

### API

- Create apps/api/src/features/causal-evidence/causalPathTypes.ts：路径 repository/snapshot 接口和内部边类型。
- Create apps/api/src/features/causal-evidence/causalPathService.ts：受限分层路径搜索、稳定排序和 10,000 状态保护。
- Create apps/api/src/features/causal-evidence/causalPathRepository.ts：PostgreSQL 只读快照、事件批量读取和按 frontier 批量读取出边。
- Create apps/api/src/features/causal-evidence/causalEvidenceBundleTypes.ts：证据 repository/snapshot 接口和批量读取记录。
- Create apps/api/src/features/causal-evidence/causalEvidenceBundleService.ts：关系路径连续性校验和证据包组装。
- Create apps/api/src/features/causal-evidence/causalEvidenceBundleRepository.ts：关系、事件和每关系限量案例的批量读取。
- Create apps/api/src/features/causal-evidence/causalEvidenceRoutes.ts：GET /api/causal-paths 与 POST /api/causal-evidence-bundles。
- Modify apps/api/src/app.ts：注册只读证据路由。
- Create apps/api/test/causal-path-service.test.ts。
- Create apps/api/test/causal-evidence-bundle-service.test.ts。
- Create apps/api/test/causal-evidence-routes.integration.test.ts。

### MCP

- Create apps/mcp/src/tools/registerEvidenceTools.ts：四个新工具的严格 MCP Schema、可读文本和注册函数。
- Modify apps/mcp/src/api/causalityApiClient.ts：案例详情、案例关系、关系搜索、路径和证据包 API 方法。
- Modify apps/mcp/src/server/createMcpServer.ts：注册证据工具并扩展组合 API 类型。
- Create apps/mcp/test/evidenceTools.test.ts。
- Modify apps/mcp/test/causalityApiClient.test.ts。
- Modify apps/mcp/test/knowledgeTools.test.ts 与 apps/mcp/test/stdioTransport.test.ts。

---

### Task 1: 定义路径与证据包共享契约

**Files:**

- Create: packages/contracts/src/causal-evidence/causalEvidenceSchemas.ts
- Create: packages/contracts/test/causal-evidence.test.ts
- Modify: packages/contracts/src/index.ts

**Interfaces:**

- Consumes: eventNameSchema、caseContentSchema、relationConfidenceSchema 和 ISO 时间格式。
- Produces: causalPathQuerySchema、causalPathResponseSchema、causalEvidenceBundleInputSchema、causalEvidenceBundleResponseSchema 以及对应类型。

- [ ] **Step 1: 写契约失败测试**

在 causal-evidence.test.ts 写以下真实行为：

    it('applies bounded path defaults', () => {
      expect(causalPathQuerySchema.parse({ sourceEventId, targetEventId })).toEqual({
        sourceEventId,
        targetEventId,
        maxDepth: 5,
        pathLimit: 10,
        minConfidence: 0,
        minCaseCount: 0,
      });
    });

    it('rejects identical path endpoints', () => {
      expect(() =>
        causalPathQuerySchema.parse({ sourceEventId, targetEventId: sourceEventId }),
      ).toThrow();
    });

    it('limits evidence bundle inputs', () => {
      expect(causalEvidenceBundleInputSchema.parse({ relationIds: [relationId] })).toEqual({
        relationIds: [relationId],
        caseLimitPerRelation: 5,
      });
      expect(() =>
        causalEvidenceBundleInputSchema.parse({
          relationIds: Array.from({ length: 11 }, (_, index) => uuid(index)),
        }),
      ).toThrow();
    });

增加 maxDepth 11、pathLimit 11、minConfidence 101、minCaseCount 1001、caseLimitPerRelation 21、重复 relation ID 和未知字段负例。构造 A → B → C 响应，断言事件、关系、跳数、最低置信度、案例总数、truncatedReason、expandedStateCount、evidenceStatus、returnedCaseCount 和 casesTruncated 都经过严格解析。

- [ ] **Step 2: 运行契约测试并确认 RED**

Run:

    pnpm --filter @causality/contracts exec vitest run test/causal-evidence.test.ts

Expected: FAIL，因为 causal-evidence Schema 与导出尚不存在。

- [ ] **Step 3: 实现严格 Schema**

核心输入结构：

    export const causalPathQuerySchema = z
      .object({
        sourceEventId: z.uuid(),
        targetEventId: z.uuid(),
        maxDepth: z.coerce.number().int().min(1).max(10).default(5),
        pathLimit: z.coerce.number().int().min(1).max(10).default(10),
        minConfidence: z.coerce.number().finite().min(0).max(100).default(0),
        minCaseCount: z.coerce.number().int().min(0).max(1_000).default(0),
      })
      .strict()
      .superRefine((value, context) => {
        if (value.sourceEventId === value.targetEventId) {
          context.addIssue({
            code: 'custom',
            path: ['targetEventId'],
            message: '起点事件和终点事件不能相同',
          });
        }
      });

    export const causalPathTruncatedReasonSchema = z.enum([
      'path_limit',
      'expansion_limit',
    ]);

    export const causalEvidenceBundleInputSchema = z
      .object({
        relationIds: z.array(z.uuid()).min(1).max(10),
        caseLimitPerRelation: z.number().int().min(1).max(20).default(5),
      })
      .strict();

路径关系至少包含 id、causeEventId、effectEventId、confidence、caseCount；路径事件包含 id、name。证据关系额外包含 description、cases、returnedCaseCount、casesTruncated 和 evidenceStatus: supported | no_cases。所有对象使用 strict，数组最大长度与设计一致。重复 relation ID 用 superRefine 在具体索引上报错。

- [ ] **Step 4: 导出 Schema 和类型**

固定类型名：

    CausalPathQuery
    CausalPathResponse
    CausalPath
    CausalPathEvent
    CausalPathRelation
    CausalEvidenceBundleInput
    CausalEvidenceBundleResponse

- [ ] **Step 5: 运行契约验证**

Run:

    pnpm --filter @causality/contracts test
    pnpm --filter @causality/contracts typecheck

Expected: 全部 PASS。

- [ ] **Step 6: 提交 Task 1**

    git add packages/contracts/src/causal-evidence/causalEvidenceSchemas.ts packages/contracts/src/index.ts packages/contracts/test/causal-evidence.test.ts
    git commit -m "feat: define causal evidence contracts"

---

### Task 2: 复用现有 API 暴露案例详情与关系搜索工具

**Files:**

- Create: apps/mcp/src/tools/registerEvidenceTools.ts
- Create: apps/mcp/test/evidenceTools.test.ts
- Modify: apps/mcp/src/api/causalityApiClient.ts
- Modify: apps/mcp/src/server/createMcpServer.ts
- Modify: apps/mcp/test/causalityApiClient.test.ts
- Modify: apps/mcp/test/knowledgeTools.test.ts
- Modify: apps/mcp/test/stdioTransport.test.ts

**Interfaces:**

- Consumes: CaseDetail、CaseRelationListResponse、RelationListResponse 和现有 /api/cases、/api/relations。
- Produces: CausalityEvidenceApi、registerEvidenceTools()、getCase()、getCaseRelations()、searchRelations()。

- [ ] **Step 1: 写 API client 请求失败测试**

断言以下调用生成准确 URL：

    await client.getCase(caseId);
    await client.getCaseRelations(caseId, {
      limit: 20,
      cursor: 'next-case-relations',
    });
    await client.searchRelations('融资成本', 'standard', 2);

预期路径依次为：

    /api/cases/{caseId}
    /api/cases/{caseId}/relations?limit=20&cursor=next-case-relations
    /api/relations?q=融资成本&searchMode=standard&page=2

分别返回非法响应，断言 client 抛出 kind: contract，不把损坏数据交给 MCP。

- [ ] **Step 2: 写两个 MCP 工具失败测试**

断言工具列表包含 get_concrete_case 和 search_causal_relations。调用案例详情后，structuredContent 必须包含 concreteCase、relations.items、hasMore 和 nextCursor；关系搜索必须透传 searchMode、分页和 semanticIndexNotice。

案例文本包含总关联数、当前返回数和下一游标；关系文本包含方向、置信度、案例数和分页信息。

- [ ] **Step 3: 运行 MCP 测试并确认 RED**

Run:

    pnpm --filter @causality/mcp exec vitest run test/causalityApiClient.test.ts test/evidenceTools.test.ts

Expected: FAIL，新增方法和工具尚不存在。

- [ ] **Step 4: 实现三个 API client 方法**

固定签名：

    getCase(id: string): Promise<CaseDetail>

    getCaseRelations(
      id: string,
      input: { limit: number; cursor?: string },
    ): Promise<CaseRelationListResponse>

    searchRelations(
      query: string,
      searchMode: 'standard' | 'enhanced',
      page?: number,
    ): Promise<RelationListResponse>

三者使用现有 request() 和 contracts 响应 Schema；关系搜索始终显式发送 searchMode，不得在 client 中回退。

- [ ] **Step 5: 实现前两个证据工具**

定义：

    export interface CausalityEvidenceApi {
      getCase(id: string): Promise<CaseDetail>;
      getCaseRelations(
        id: string,
        input: { limit: number; cursor?: string },
      ): Promise<CaseRelationListResponse>;
      searchRelations(
        query: string,
        searchMode: SearchMode,
        page?: number,
      ): Promise<RelationListResponse>;
    }

    export function registerEvidenceTools(
      server: McpServer,
      apiClient: CausalityEvidenceApi,
    ): void;

get_concrete_case 并行调用案例详情与案例关系；search_causal_relations 直接返回关系分页。输入对象都 strict，输出使用 contracts Schema 组合；annotations 使用只读四项标记。

- [ ] **Step 6: 注册工具并更新中间工具数回归**

createMcpServer.ts 中组合 CausalityKnowledgeApi & CausalityEvidenceApi & CausalityCaptureApi，并在知识工具后注册证据工具。此任务结束时工具数为 13；保留对原 11 个工具名称的断言。

- [ ] **Step 7: 运行 MCP 回归**

Run:

    pnpm --filter @causality/mcp test
    pnpm --filter @causality/mcp typecheck

Expected: 全部 PASS，工具数 13。

- [ ] **Step 8: 提交 Task 2**

    git add apps/mcp/src/api/causalityApiClient.ts apps/mcp/src/server/createMcpServer.ts apps/mcp/src/tools/registerEvidenceTools.ts apps/mcp/test/causalityApiClient.test.ts apps/mcp/test/evidenceTools.test.ts apps/mcp/test/knowledgeTools.test.ts apps/mcp/test/stdioTransport.test.ts
    git commit -m "feat: expose MCP case detail and relation search"

---

### Task 3: 实现受限有向路径纯服务

**Files:**

- Create: apps/api/src/features/causal-evidence/causalPathTypes.ts
- Create: apps/api/src/features/causal-evidence/causalPathService.ts
- Create: apps/api/test/causal-path-service.test.ts

**Interfaces:**

- Consumes: CausalPathQuery、CausalPathResponse、CausalPathEvent、CausalPathRelation。
- Produces: CausalPathSnapshot、CausalPathRepository、CausalPathService.query()、CausalPathServiceError。

- [ ] **Step 1: 定义测试 repository 并写路径 RED**

固定 repository 接口：

    interface CausalPathSnapshot {
      findEvents(ids: string[]): Promise<CausalPathEvent[]>;
      findOutgoingRelations(
        causeEventIds: string[],
        filters: { minConfidence: number; minCaseCount: number },
      ): Promise<CausalPathRelation[]>;
    }

    interface CausalPathRepository {
      withSnapshot<T>(
        operation: (snapshot: CausalPathSnapshot) => Promise<T>,
      ): Promise<T>;
    }

独立测试以下行为：

1. A → B 返回一跳路径。
2. A → B → C 返回真实顺序。
3. C → B → A 不被当作 A → C。
4. A → B → A 不重复事件。
5. 置信度和案例数过滤生效。
6. 跳数优先，同跳数按案例总数、最低置信度、关系 ID 序列排序。
7. 少于 10 条短路径时继续更深层直到填满或耗尽。
8. 超过 10 条结果返回 10 条和 path_limit。
9. 第 10,001 个状态不再扩展，返回 expansion_limit 和 10000。
10. 起点或终点缺失抛出带具体端点的 EVENT_NOT_FOUND。

- [ ] **Step 2: 运行纯服务测试并确认 RED**

Run:

    pnpm --filter @causality/api exec vitest run test/causal-path-service.test.ts

Expected: FAIL，路径服务尚不存在。

- [ ] **Step 3: 实现分层状态机**

内部状态：

    interface PathState {
      events: CausalPathEvent[];
      relations: CausalPathRelation[];
      visitedEventIds: ReadonlySet<string>;
      minimumConfidence: number;
      totalCaseCount: number;
    }

每层只用当前状态末端事件 ID 批量调用一次 findOutgoingRelations()，再按 causeEventId 建 adjacency map；对本层首次出现的 effectEventId 批量调用一次 findEvents()，得到下一层需要的事件名称，禁止逐边读取事件。每产生一个合法新状态，expandedStateCount 加一；达到 10,000 后停止产生状态。关系引用了不存在的结果事件时作为数据库完整性异常处理，不生成缺少名称的路径节点。

不得在第一次到达目标时停止。完成当前深度后按设计排序；累计结果达到 pathLimit 时停止更深搜索。同层结果先完整排序再截断。

确定性字符串比较使用 UTF-16 全序，不使用 localeCompare：

    function compareText(left: string, right: string): number {
      return left < right ? -1 : left > right ? 1 : 0;
    }

- [ ] **Step 4: 实现响应和错误**

query() 在 repository.withSnapshot() 内完成端点读取、逐层扩展和响应组装。空路径返回 paths: []。截断优先级固定为 expansion_limit 高于 path_limit；未截断时 truncatedReason 为 null。

- [ ] **Step 5: 运行路径单测与类型检查**

Run:

    pnpm --filter @causality/api exec vitest run test/causal-path-service.test.ts
    pnpm --filter @causality/api typecheck

Expected: 全部 PASS。

- [ ] **Step 6: 提交 Task 3**

    git add apps/api/src/features/causal-evidence/causalPathTypes.ts apps/api/src/features/causal-evidence/causalPathService.ts apps/api/test/causal-path-service.test.ts
    git commit -m "feat: add bounded causal path service"

---

### Task 4: 接入 PostgreSQL 路径 repository 与 HTTP API

**Files:**

- Create: apps/api/src/features/causal-evidence/causalPathRepository.ts
- Create: apps/api/src/features/causal-evidence/causalEvidenceRoutes.ts
- Create: apps/api/test/causal-evidence-routes.integration.test.ts
- Modify: apps/api/src/app.ts

**Interfaces:**

- Consumes: Task 3 的 CausalPathRepository 和 CausalPathService。
- Produces: PostgresCausalPathRepository 和 GET /api/causal-paths。

- [ ] **Step 1: 写隔离 PostgreSQL 路由失败测试**

建立 A → B → C、反向边、环边和低质量边，调用 GET /api/causal-paths，断言两跳路径、truncated false、truncatedReason null。再验证缺失端点 404、相同端点 400、反向查询为空、过滤后为空、响应满足 contracts Schema。

- [ ] **Step 2: 运行集成测试并确认 RED**

Run:

    DOCKER_HOST="$(docker context inspect --format '{{.Endpoints.docker.Host}}')" TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock pnpm --filter @causality/api exec vitest run --config vitest.integration.config.ts test/causal-evidence-routes.integration.test.ts

Expected: FAIL，路由返回 404。

- [ ] **Step 3: 实现 PostgreSQL 只读快照**

withSnapshot() 使用：

    begin transaction isolation level repeatable read read only

findEvents(ids) 使用 id = any($1::uuid[])。findOutgoingRelations(frontierIds, filters) 使用一次聚合查询：

    select r.id,
           r.cause_event_id,
           r.effect_event_id,
           r.confidence,
           count(crc.concrete_case_id)::int as case_count
    from causal_relations r
    left join causal_relation_cases crc
      on crc.causal_relation_id = r.id
    where r.cause_event_id = any($1::uuid[])
      and r.confidence >= $2
    group by r.id
    having count(crc.concrete_case_id) >= $3
    order by r.cause_event_id, r.id

现有 cause_event_id 前缀索引、relation-case 主键和 relation-linked index 足够；本任务不新增迁移。

- [ ] **Step 4: 注册 GET 路由和错误映射**

registerCausalEvidenceRoutes(app, pool) 创建路径 service。路由使用 causalPathQuerySchema 和 causalPathResponseSchema；EVENT_NOT_FOUND 返回 404，参数错误 400，未知错误交给全局 500。

- [ ] **Step 5: 注册到应用并验证 OpenAPI**

在 app.ts 的 database routes 中注册。集成测试读取 /api/openapi.json，确认只暴露 GET 且响应 Schema 已注册。

- [ ] **Step 6: 运行路径 API 回归**

Run:

    DOCKER_HOST="$(docker context inspect --format '{{.Endpoints.docker.Host}}')" TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock pnpm --filter @causality/api exec vitest run --config vitest.integration.config.ts test/causal-evidence-routes.integration.test.ts
    pnpm --filter @causality/api typecheck

Expected: 全部 PASS。

- [ ] **Step 7: 提交 Task 4**

    git add apps/api/src/app.ts apps/api/src/features/causal-evidence/causalPathRepository.ts apps/api/src/features/causal-evidence/causalEvidenceRoutes.ts apps/api/test/causal-evidence-routes.integration.test.ts
    git commit -m "feat: expose causal path query API"

---

### Task 5: 实现证据包只读快照与 HTTP API

**Files:**

- Create: apps/api/src/features/causal-evidence/causalEvidenceBundleTypes.ts
- Create: apps/api/src/features/causal-evidence/causalEvidenceBundleService.ts
- Create: apps/api/src/features/causal-evidence/causalEvidenceBundleRepository.ts
- Create: apps/api/test/causal-evidence-bundle-service.test.ts
- Modify: apps/api/src/features/causal-evidence/causalEvidenceRoutes.ts
- Modify: apps/api/test/causal-evidence-routes.integration.test.ts

**Interfaces:**

- Consumes: CausalEvidenceBundleInput 和 CausalEvidenceBundleResponse。
- Produces: CausalEvidenceBundleRepository、CausalEvidenceBundleService.build()、PostgresCausalEvidenceBundleRepository、POST /api/causal-evidence-bundles。

- [ ] **Step 1: 写纯服务连续性失败测试**

覆盖：

1. A → B、B → C 生成 A、B、C。
2. 反序或不连续关系返回 EVIDENCE_PATH_INVALID，字段指向具体 relationIds 索引。
3. 重复关系在 contracts 层被拒绝。
4. 关系缺失返回 EVIDENCE_RELATION_NOT_FOUND 和关系 ID。
5. 当前关系形成事件循环返回 EVIDENCE_PATH_CYCLE。
6. 无案例关系返回 no_cases、空案例、casesTruncated false。
7. 总数大于返回数时为 supported 且 casesTruncated true。
8. 最低置信度与案例总数正确。

- [ ] **Step 2: 运行证据服务测试并确认 RED**

Run:

    pnpm --filter @causality/api exec vitest run test/causal-evidence-bundle-service.test.ts

Expected: FAIL，证据模块尚不存在。

- [ ] **Step 3: 实现 repository 接口和服务**

固定接口：

    interface CausalEvidenceBundleSnapshot {
      findRelations(ids: string[]): Promise<EvidenceRelationRecord[]>;
      findCasesByRelationIds(
        ids: string[],
        limitPerRelation: number,
      ): Promise<EvidenceCasesByRelation[]>;
    }

    interface CausalEvidenceBundleRepository {
      withSnapshot<T>(
        operation: (snapshot: CausalEvidenceBundleSnapshot) => Promise<T>,
      ): Promise<T>;
    }

服务按输入 ID 重建关系顺序，验证 previous.effectEventId 等于 current.causeEventId 且事件不重复，再组装事件、关系、案例和汇总字段。错误 code 固定为 EVIDENCE_RELATION_NOT_FOUND、EVIDENCE_PATH_INVALID、EVIDENCE_PATH_CYCLE。

- [ ] **Step 4: 实现 PostgreSQL 批量读取**

关系查询一次读取全部关系和两端事件。案例查询使用 window function：

    with ranked_cases as (
      select crc.causal_relation_id,
             c.id,
             c.content,
             crc.linked_at,
             count(*) over (
               partition by crc.causal_relation_id
             )::int as total_count,
             row_number() over (
               partition by crc.causal_relation_id
               order by crc.linked_at desc, c.id
             ) as row_number
      from causal_relation_cases crc
      join concrete_cases c
        on c.id = crc.concrete_case_id
      where crc.causal_relation_id = any($1::uuid[])
    )
    select *
    from ranked_cases
    where row_number <= $2
    order by causal_relation_id, row_number

整个组装使用 repeatable read read only，不执行逐关系查询。

- [ ] **Step 5: 写并实现 POST 路由**

先在集成测试断言正常证据包、无案例、截断、缺失关系和不连续路径；再注册 POST，使用 contracts Schema，把业务错误映射为 404 或 409。错误消息说明重新查询路径或修正顺序，不返回 SQL。

- [ ] **Step 6: 运行证据 API 回归**

Run:

    pnpm --filter @causality/api exec vitest run test/causal-evidence-bundle-service.test.ts
    DOCKER_HOST="$(docker context inspect --format '{{.Endpoints.docker.Host}}')" TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock pnpm --filter @causality/api exec vitest run --config vitest.integration.config.ts test/causal-evidence-routes.integration.test.ts
    pnpm --filter @causality/api typecheck

Expected: 全部 PASS。

- [ ] **Step 7: 提交 Task 5**

    git add apps/api/src/features/causal-evidence/causalEvidenceBundleTypes.ts apps/api/src/features/causal-evidence/causalEvidenceBundleService.ts apps/api/src/features/causal-evidence/causalEvidenceBundleRepository.ts apps/api/src/features/causal-evidence/causalEvidenceRoutes.ts apps/api/test/causal-evidence-bundle-service.test.ts apps/api/test/causal-evidence-routes.integration.test.ts
    git commit -m "feat: add causal evidence bundle API"

---

### Task 6: 暴露路径与证据包 MCP 工具

**Files:**

- Modify: apps/mcp/src/tools/registerEvidenceTools.ts
- Modify: apps/mcp/src/api/causalityApiClient.ts
- Modify: apps/mcp/test/evidenceTools.test.ts
- Modify: apps/mcp/test/causalityApiClient.test.ts
- Modify: apps/mcp/test/knowledgeTools.test.ts
- Modify: apps/mcp/test/stdioTransport.test.ts

**Interfaces:**

- Consumes: Task 1 contracts 与 Task 4、Task 5 API。
- Produces: findCausalPaths()、getCausalEvidenceBundle() 和最终 15 工具 Server。

- [ ] **Step 1: 写 API client 请求失败测试**

断言 findCausalPaths() 发送带全部参数的 GET；getCausalEvidenceBundle() 发送带 relationIds 和 caseLimitPerRelation JSON body 的 POST。非法返回触发 contract error。

- [ ] **Step 2: 写两个 MCP 工具失败测试**

find_causal_paths 文本包含起终点、路径数量、有序事件链、关系 ID、跳数、最低置信度、案例总数和 expansion_limit 不完整警告。

get_causal_evidence_bundle 文本包含完整事件链、关系说明、置信度、总案例数、已返回案例和“无案例依据”。structuredContent 与 API 响应相同。

- [ ] **Step 3: 运行聚焦测试并确认 RED**

Run:

    pnpm --filter @causality/mcp exec vitest run test/causalityApiClient.test.ts test/evidenceTools.test.ts

Expected: FAIL，后两个方法和工具尚不存在。

- [ ] **Step 4: 实现 client 与严格 MCP Schema**

新增：

    findCausalPaths(
      input: CausalPathQuery,
    ): Promise<CausalPathResponse>

    getCausalEvidenceBundle(
      input: CausalEvidenceBundleInput,
    ): Promise<CausalEvidenceBundleResponse>

MCP 输入使用本地严格数字 Schema，不复用带 z.coerce 的 HTTP query Schema；输出镜像 contracts 字段和上限。annotations 与前两个工具一致。

- [ ] **Step 5: 实现摘要和错误透传**

空路径写“当前筛选条件下没有找到有向路径”。任何 truncatedReason 在首段说明结果不完整。案例为空写“无案例依据”，不得写“已验证”。不捕获并改写 CausalityApiClientError。

- [ ] **Step 6: 更新最终工具清单为 15**

断言原 11 个名称仍存在，新 4 个名称各一次，总数 15。HTTP 与 stdio 继续共用 createCausalityMcpServer()。

- [ ] **Step 7: 运行 MCP 全量验证**

Run:

    pnpm --filter @causality/mcp test
    pnpm --filter @causality/mcp typecheck

Expected: 全部 PASS，工具数 15。

- [ ] **Step 8: 提交 Task 6**

    git add apps/mcp/src/api/causalityApiClient.ts apps/mcp/src/tools/registerEvidenceTools.ts apps/mcp/test/causalityApiClient.test.ts apps/mcp/test/evidenceTools.test.ts apps/mcp/test/knowledgeTools.test.ts apps/mcp/test/stdioTransport.test.ts
    git commit -m "feat: expose causal path evidence tools"

---

### Task 7: 补齐高分支性能与跨层回归

**Files:**

- Modify: apps/api/test/causal-path-service.test.ts
- Modify: apps/api/test/causal-evidence-routes.integration.test.ts
- Modify: apps/mcp/test/evidenceTools.test.ts

**Interfaces:**

- Consumes: Tasks 1–6 完整行为。
- Produces: 组合爆炸保护、只读性和 API/MCP 同构的发布级回归证据。

- [ ] **Step 1: 写高分支确定性回归**

构造理论路径数超过 10,000 的图，断言：

    expect(result.expandedStateCount).toBe(10_000);
    expect(result.truncated).toBe(true);
    expect(result.truncatedReason).toBe('expansion_limit');
    expect(result.paths.length).toBeLessThanOrEqual(10);
    expect(snapshot.maxBatchSize).toBeLessThan(totalRelationCount);

不得使用毫秒阈值证明复杂度。

- [ ] **Step 2: 写真实 PostgreSQL 高分支与只读回归**

构造至少三层的多分支数据，通过真实 HTTP 路径查询确认返回路径不超过 10、扩展状态不超过 10,000，并与纯服务测试中的批量 frontier 调用断言共同覆盖查询边界。调用前后比较四张业务表计数和 updated_at 最大值，确认路径与证据 API 没有写操作。

- [ ] **Step 3: 写 API/MCP 同构流程回归**

依次调用 search_causal_relations、find_causal_paths、get_causal_evidence_bundle；比较 MCP structuredContent 与 API fixtures，并断言没有调用 compare、prepare 或 commit。

- [ ] **Step 4: 运行聚焦回归**

Run:

    pnpm --filter @causality/api exec vitest run test/causal-path-service.test.ts test/causal-evidence-bundle-service.test.ts
    DOCKER_HOST="$(docker context inspect --format '{{.Endpoints.docker.Host}}')" TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock pnpm --filter @causality/api exec vitest run --config vitest.integration.config.ts test/causal-evidence-routes.integration.test.ts
    pnpm --filter @causality/mcp exec vitest run test/evidenceTools.test.ts

Expected: 全部 PASS，无业务写入。

- [ ] **Step 5: 提交 Task 7**

    git add apps/api/test/causal-path-service.test.ts apps/api/test/causal-evidence-routes.integration.test.ts apps/mcp/test/evidenceTools.test.ts
    git commit -m "test: cover causal evidence query limits"

---

### Task 8: 完整验证与人工复核交付

**Files:**

- Modify: docs/superpowers/specs/2026-07-30-p3-01r1-task4-readonly-query-evidence-tools-design.md
- Modify: docs/superpowers/specs/2026-07-29-p3-01r1-mcp-quality-query-optimization-design.md
- Modify: docs/superpowers/plans/2026-07-20-causality-application-roadmap.md

**Interfaces:**

- Consumes: Tasks 1–7 代码、测试、15 工具清单和设计验收项。
- Produces: “实施完成，等待人工复核”的 Task 4 发布候选。

- [ ] **Step 1: 运行受影响工作区测试**

Run:

    pnpm --filter @causality/contracts test
    pnpm --filter @causality/api test
    pnpm --filter @causality/mcp test

Expected: 全部 PASS。

- [ ] **Step 2: 运行 API 隔离集成测试**

Run:

    DOCKER_HOST="$(docker context inspect --format '{{.Endpoints.docker.Host}}')" TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock pnpm --filter @causality/api test:integration

Expected: 全部 PASS；只使用 Testcontainers 隔离数据库。

- [ ] **Step 3: 运行全仓质量门禁**

Run:

    pnpm lint
    pnpm format:check
    pnpm typecheck
    pnpm test
    pnpm build
    git diff --check

Expected: 全部 exit 0；只允许既有 Web 大分块警告。

- [ ] **Step 4: 更新阶段记录**

把 Task 4 设计、P3-01R1 阶段设计和路线图更新为“实施完成，等待人工复核”，记录实际命令和结果。不得提前把 Task 4 或 P3-01R1 标为“已完成”。

- [ ] **Step 5: 准备人工验收清单**

交付以下八项，不代替用户执行：

1. 查询案例并使用游标续页。
2. 普通和增强关系搜索。
3. 直接、多层和无路径场景。
4. 调整最低置信度和最少案例数。
5. 用路径关系序列生成证据包。
6. 提交反序、不连续或重复关系 ID。
7. 确认无案例关系显示“无案例依据”。
8. 确认四个工具没有修改业务数据。

- [ ] **Step 6: 提交发布候选**

    git add docs/superpowers/specs/2026-07-30-p3-01r1-task4-readonly-query-evidence-tools-design.md docs/superpowers/specs/2026-07-29-p3-01r1-mcp-quality-query-optimization-design.md docs/superpowers/plans/2026-07-20-causality-application-roadmap.md
    git commit -m "docs: prepare Task 4 evidence tools review"

提交后停在人工复核门禁，不推送 GitHub，不自动进入 Task 5。

## Plan Self-Review Checklist

- [x] 四个工具分别有明确任务，最终工具数为 15。
- [x] 案例详情与关系搜索复用现有 API。
- [x] 路径覆盖方向、简单路径、排序、深度、数量、筛选和 10,000 状态保护。
- [x] 证据包覆盖连续性、缺失、循环、无案例、截断和只读快照。
- [x] MCP 不自行计算路径或静默降级增强搜索。
- [x] HTTP 与 stdio 共用注册工厂，现有 11 工具兼容。
- [x] 没有数据库业务表、Web、Prompt、Resource、写权限或联网搜索扩展。
- [x] 每个任务都有 RED、GREEN、精确命令和独立提交。
