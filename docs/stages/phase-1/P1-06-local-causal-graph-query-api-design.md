# P1-06 局部因果图查询 API 设计

版本：V1.0
日期：2026-07-24
状态：设计已确认，开发中
所属路线图步骤：P1-06 局部因果图查询 API
前置步骤：P1-05 已完成人工验收并提交

## 1. 目标

提供一个以原子事件为中心的只读局部因果图查询 API，使后续图形页面可以按上游、下游或双向模式取得稳定、规模受控的节点和关系集合。

查询在达到节点数量或关系数量保护上限后立即停止，不继续遍历整个可达网络，也不计算完整匹配数量。P1-06 只建立通用图数据接口，不绑定 Cytoscape.js 或 ELK。

## 2. 非目标

P1-06 不实现：

- 局部因果图 Web 页面；
- Cytoscape.js 元素格式；
- ELK 自动布局；
- Zoom、Pan、拖动、悬浮和键盘交互；
- 图会话、服务端布局状态或扩展游标；
- 节点详情、关系说明和案例明细；
- 全局因果图；
- 完整可达节点数量统计；
- AI、语义搜索、自动置信度或条件化关系。

## 3. 已确认原则

- 中心事件不计入 20、50、100 的节点上限；
- 查询采用按层级优先的广度优先遍历；
- 双向模式的上游和下游共用一个候选队列，不预留数量比例；
- 同一层内按置信度降序、案例数量降序、关系 ID 升序处理候选关系；
- 节点选定后返回这些节点之间所有符合筛选条件的关系；
- 允许分支、汇合、反向关系和循环，事件在响应中只出现一次；
- 关系数量上限为节点档位的 10 倍；
- 关系过密时返回不超过关系上限的最大稳定节点前缀；
- 20、50、100 每次都重新查询，不保存图会话；
- 不设置遍历深度限制；
- P1-06 同时支持最低置信度和最低案例数筛选；
- API 返回通用的节点、关系和元数据，不返回 Cytoscape.js 专用结构；
- 图节点和关系只返回绘图必要字段，详情继续调用现有 API；
- 服务端采用应用层分层 BFS，每层执行一次批量 SQL。

## 4. API 契约

### 4.1 路径

```http
GET /api/causal-graph
```

### 4.2 查询参数

| 参数            | 类型                          | 必填 | 默认值 | 说明                         |
| --------------- | ----------------------------- | ---- | ------ | ---------------------------- |
| centerEventId   | UUID                          | 是   | 无     | 中心原子事件                 |
| direction       | upstream、downstream 或 both  | 是   | 无     | 遍历方向                     |
| limit           | 20、50 或 100                 | 否   | 20     | 中心事件以外的最大节点数     |
| minConfidence   | 0–100 整数                    | 否   | 0      | 最低人工置信度               |
| minCaseCount    | 非负整数                      | 否   | 0      | 最低具体案例数量             |

`limit=20` 最多返回 21 个节点，即中心事件和最多 20 个关联事件。

节点档位与关系保护上限固定对应：

| 节点上限 | 关系上限 |
| -------: | -------: |
|       20 |      200 |
|       50 |      500 |
|      100 |     1000 |

### 4.3 成功响应

```ts
interface CausalGraphResponse {
  nodes: Array<{
    id: string;
    name: string;
  }>;
  relations: Array<{
    id: string;
    causeEventId: string;
    effectEventId: string;
    confidence: number;
    caseCount: number;
  }>;
  meta: {
    centerEventId: string;
    direction: 'upstream' | 'downstream' | 'both';
    nodeLimit: 20 | 50 | 100;
    relationLimit: 200 | 500 | 1000;
    minConfidence: number;
    minCaseCount: number;
    nodeCount: number;
    relationCount: number;
    stopReason: 'exhausted' | 'node_limit' | 'relation_limit';
  };
}
```

`nodeCount` 包含中心事件。响应不包含完整可达数量和 `hasMore`。

### 4.4 字段边界

节点不返回说明、别名、关键词或关系统计。后续点击节点时使用现有事件详情 API。

关系不返回说明或最近案例，只返回原因端、结果端、置信度和案例数量。后续点击关系时使用现有关系详情 API。

## 5. 遍历语义

### 5.1 方向

- `upstream`：从关系的结果事件向原因事件遍历；
- `downstream`：从关系的原因事件向结果事件遍历；
- `both`：两种方向都可遍历，候选关系进入同一个排序队列；
- 响应中的关系始终保留真实的原因事件到结果事件方向。

### 5.2 筛选

关系必须同时满足：

```text
confidence >= minConfidence
caseCount >= minCaseCount
```

筛选在遍历前生效。不满足筛选条件的关系既不返回，也不能用于到达更远的节点。

案例数量从 `causal_relation_cases` 实时聚合，不写入冗余字段。筛选不会改变关系置信度。

### 5.3 分层 BFS

服务端维护：

- 已访问事件集合，初始包含中心事件；
- 当前层事件集合；
- 按发现顺序保存的节点序列；
- 发现每个节点时使用的候选关系顺序。

每一层通过一次批量 SQL 查询取得当前层所有符合方向和筛选条件的关系，不执行逐节点查询。

候选关系统一排序：

```text
confidence desc
case_count desc
relation_id asc
```

按排序顺序检查相邻事件。未访问事件加入下一层和节点序列；已访问事件不会再次加入，但对应关系仍可能在最终完整关系查询中返回。

如果同一事件能经多条关系或路径到达，排序最靠前的候选关系决定其首次发现位置。

### 5.4 循环

循环检测只依赖已访问事件集合，不把循环视为错误。遍历不会因循环重复访问事件或无限执行。

节点选定后，循环中的其他关系只要两端节点都已选中且符合筛选条件，就会进入响应。

### 5.5 节点上限

达到 20、50 或 100 个非中心节点后立即停止，不额外查询下一层，也不探测是否恰好还有其他节点。

因此 `stopReason = node_limit` 表示查询按要求在节点档位停止，不承诺网络中一定存在更多节点。20 和 50 档的页面可以提供下一档扩展；100 档不再提供整体扩展。

如果当前层耗尽且没有新节点，返回 `stopReason = exhausted`。

## 6. 完整关系与关系上限

完成节点发现后，Repository 使用一次参数化 SQL 查询所选节点之间所有符合筛选条件的关系。该查询不受遍历方向限制，因此可以保留所选节点之间的交叉、汇合、反向和循环关系。

关系集合按以下规则排序：

```text
confidence desc
case_count desc
relation_id asc
```

如果完整关系数超过当前档位的保护上限，Service 根据节点发现顺序计算最大稳定前缀：

1. 中心事件始终保留；
2. 依次加入已发现节点；
3. 加入某节点后，其与当前前缀内其他节点之间的全部符合条件关系同时生效；
4. 如果关系数将超过保护上限，则不加入该节点；
5. 该节点及其后的节点全部移除；
6. 返回最后一个未超限的完整局部图；
7. `stopReason` 设置为 `relation_limit`。

关系上限优先于先前暂定的 `node_limit` 或 `exhausted` 停止原因。接口不会为了保留更多节点而截断节点之间真实存在的关系。

## 7. 后端结构

P1-06 新增独立功能模块，避免把图查询混入关系 CRUD：

```text
causalGraphRoutes
  请求校验、OpenAPI、HTTP 状态映射

causalGraphService
  分层 BFS、去重、停止条件、最大稳定前缀

causalGraphRepository
  中心事件查询
  当前层批量关系查询
  所选节点完整关系查询
  只读事务边界
```

共享契约包提供查询、节点、关系、元数据和响应 Schema 与类型。

Repository 接口不暴露 SQL 细节，使 Service 单元测试可以使用内存替身精确验证遍历行为和查询次数。

## 8. 数据一致性与数据库策略

应用层 BFS 会执行多次 SQL。一次图查询必须使用同一个 PostgreSQL 连接，并在只读、可重复读事务中完成：

```sql
begin transaction isolation level repeatable read read only;
```

这样并发修改关系或案例时，所有遍历层和最终关系集合仍基于同一个数据库快照。成功后提交只读事务，异常时回滚并释放连接。

现有索引提供初始查询基础：

- `causal_relations_cause_event_id_idx`：下游遍历；
- `causal_relations_effect_event_id_idx`：上游遍历；
- `causal_relation_cases` 以关系 ID 开头的主键：案例数量统计。

P1-06 默认不新增数据库表、缓存、Redis、图数据库或服务端状态。只有性能基线和 `EXPLAIN` 证明现有索引不足时，才补充与图查询直接相关的索引，并在实现记录中说明原因。

## 9. 错误处理

| 场景                         | HTTP | 错误代码         |
| ---------------------------- | ---: | ---------------- |
| 查询参数无效                 |  400 | VALIDATION_ERROR |
| 中心事件不存在               |  404 | EVENT_NOT_FOUND  |
| 数据库不可用或未知查询错误   |  500 | INTERNAL_ERROR   |

关系过密不是错误，返回较小但关系完整的局部图，并设置 `relation_limit`。

孤立中心事件正常返回 `200`，包含一个中心节点、零条关系，停止原因为 `exhausted`。

错误响应继续复用现有共享错误结构，不向客户端暴露 SQL、堆栈或内部连接信息。

## 10. 性能基线

新增独立命令：

```bash
pnpm graph:benchmark
```

基准命令使用一次性 PostgreSQL 测试环境，不污染开发数据库。数据规模：

```text
100,000 个事件
500,000 条关系
足够覆盖 minCaseCount 筛选的案例及关联
```

预热后选择低、中、高连接度的多个中心事件，覆盖：

- upstream、downstream、both；
- `limit=100`；
- 无筛选；
- 最低置信度筛选；
- 最低案例数筛选；
- 两种筛选组合。

报告每次耗时、平均值、P95 和最大值。P95 必须不超过 2 秒。超过目标时 P1-06 不能进入人工复核，必须先检查查询计划、批量大小和索引使用情况。

性能基线不并入日常快速单元测试，但属于 P1-06 自动化验收门禁。

## 11. 自动化测试

### 11.1 共享契约

- 中心事件 UUID 必填；
- 三种方向；
- 20、50、100 三个档位；
- 置信度 0–100 整数；
- 非负案例数量；
- 查询默认值；
- 严格节点、关系、元数据和响应结构；
- 三种停止原因。

### 11.2 Service 单元测试

- upstream、downstream、both；
- 双向模式使用统一候选队列；
- 中心事件不计入节点上限；
- 分层优先和同层稳定排序；
- 分支、汇合、反向关系和循环；
- 多路径节点去重；
- 所选节点之间完整关系返回；
- 最低置信度和最低案例数筛选；
- 达到 20、50、100 后不查询下一层；
- 关系上限和最大稳定前缀；
- 孤立中心事件；
- 事务提交、回滚和连接释放。

### 11.3 PostgreSQL 集成测试

- 三种方向及组合筛选；
- 真实案例数量聚合；
- 节点和关系稳定顺序；
- 循环查询终止；
- 只读可重复读快照；
- 400、404、500 和 OpenAPI；
- 原因端、结果端和案例关联索引的查询计划。

## 12. 人工复核

P1-06 不新增 Web 页面，不需要视觉复核。自动化测试通过后，使用 curl 或 API 客户端检查：

1. 三个方向返回正确的局部网络；
2. 中心事件不计入 20、50、100 上限；
3. 筛选关系不能作为继续遍历的路径；
4. 反向关系和循环可以正常返回；
5. 所选节点之间的关系完整；
6. 节点达限后不继续统计全部网络；
7. 关系过密时返回关系完整的较小图；
8. 不存在的中心事件返回 404；
9. 极端规模 P95 不超过 2 秒。

只有用户明确确认人工复核通过，P1-06 才标记为完成并进入 P1-07。

## 13. 预计文件

预计新增：

```text
packages/contracts/src/causal-graph/causalGraphSchemas.ts
packages/contracts/test/causal-graph.test.ts
apps/api/src/features/causal-graph/causalGraphRepository.ts
apps/api/src/features/causal-graph/causalGraphService.ts
apps/api/src/features/causal-graph/causalGraphRoutes.ts
apps/api/test/causal-graph-service.test.ts
apps/api/test/causal-graph.integration.test.ts
apps/api/test/causal-graph-benchmark.ts
```

预计修改：

```text
packages/contracts/src/index.ts
apps/api/src/app.ts
apps/api/package.json
package.json
README.md
docs/superpowers/plans/2026-07-20-causality-application-roadmap.md
```

默认不创建数据库迁移。只有性能基线证明需要新索引时，才生成新的迁移及 Drizzle 元数据。

## 14. 审核重点

请重点确认：

1. 中心事件不计入节点上限；
2. 不返回完整匹配数量或 `hasMore`；
3. 达到请求档位后立即停止，不做额外探测；
4. 双向模式使用统一候选队列；
5. 同层按置信度、案例数、关系 ID 排序；
6. 返回所选节点之间的全部符合条件关系；
7. 关系过密时缩小节点前缀，不截断真实关系；
8. P1-06 已包含最低置信度和最低案例数筛选；
9. 应用层分层 BFS 每层只执行一次批量 SQL；
10. 100,000 事件、500,000 关系下 P95 不超过 2 秒。
