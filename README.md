# Causality

金融因果知识库。P1-03 抽象原子事件管理、P1-04 抽象因果关系管理、P1-05 具体案例管理、P1-06 局部因果图查询 API 和 P1-07 局部因果图基础展示均已完成验收。

当前可用功能：

- 浏览和搜索抽象原子事件；
- 创建、查看和编辑事件、别名及关键词；
- 创建和编辑时显示可能重复的候选事件；
- 浏览、搜索、创建、展开查看和编辑有向因果关系；
- 从已有事件中选择关系两端，人工填写 0–100 的置信度；
- 阻止自环和同方向重复关系，允许反向关系并显示提示；
- 独立浏览、搜索、创建、查看和编辑最多 50 字的具体案例；
- 在关系表单中搜索复用已有案例，或显式创建新案例；
- 一个案例可支持多条关系，关系展开显示真实案例数和最近 5 条；
- 以一个原子事件为中心查询上游、下游或双向局部因果图；
- 使用 20、50、100 节点档位限制图规模，并按最低置信度和最低案例数筛选；
- 在 Web 因果图页面搜索中心事件，以初始 20 节点档位展示有向分层图；
- 图页面支持上游、下游、双向切换，以及缩放、平移和适应画布；
- 通过 REST API 完成相同操作；
- 查看 API 与数据库运行状态。

## 本地要求

- Node.js 24.18.0
- pnpm 11.15.1
- Docker（包含 Compose）

## 启动

先进入包含 `package.json`、`compose.yaml` 和 `apps` 的仓库根目录：

```bash
cd /path/to/causality
pnpm install
cp apps/api/.env.example apps/api/.env
docker compose up -d --wait postgres
pnpm dev
```

浏览器打开 <http://127.0.0.1:5173>，首页会进入事件列表。因果关系页为 <http://127.0.0.1:5173/relations>，具体案例页为 <http://127.0.0.1:5173/cases>，局部因果图页为 <http://127.0.0.1:5173/graph>，系统状态页为 <http://127.0.0.1:5173/system>，API 默认监听 <http://127.0.0.1:3000>。

在“因果图”页面输入事件名称或别名并选择候选项，系统会自动生成默认双向图。方向和中心事件保存在 URL 中，刷新或复制链接后可以恢复同一张图。

事件 API：

- `GET /api/events`：列表、传统搜索和游标分页；
- `GET /api/events/candidates`：重复候选；
- `GET /api/events/:eventId`：详情；
- `POST /api/events`：创建；
- `PUT /api/events/:eventId`：完整更新。

因果关系 API：

- `GET /api/relations`：列表、传统搜索和游标分页；
- `GET /api/relations/pair-check`：检查同方向和反向关系；
- `GET /api/relations/:relationId`：详情；
- `POST /api/relations`：创建；
- `PUT /api/relations/:relationId`：完整更新。

具体案例 API：

- `GET /api/cases`：列表、传统搜索、关系筛选和游标分页；
- `GET /api/cases/candidates`：关系表单候选案例；
- `GET /api/cases/:caseId`：详情；
- `GET /api/cases/:caseId/relations`：案例关联的因果关系；
- `POST /api/cases`：创建独立案例；
- `PUT /api/cases/:caseId`：完整更新。

局部因果图 API：

- `GET /api/causal-graph`：以 `centerEventId` 为中心查询局部图；
- `direction` 必须是 `upstream`、`downstream` 或 `both`；
- `limit` 可选 20、50、100，默认 20，且不包含中心事件；
- `minConfidence` 和 `minCaseCount` 分别筛选最低置信度和最低案例数；
- 返回通用的 `nodes`、`relations` 和 `meta`，不计算完整可达数量。

## 数据库

```bash
pnpm db:migrate
pnpm db:seed
pnpm db:verify
pnpm db:simulate -- --events=1000 --relations=3000 --cases=10000 --seed=42
pnpm graph:benchmark
```

迁移可重复执行。固定种子采用稳定标识并且不会覆盖已修改的数据；模拟数据只用于开发和性能测试。`db:verify` 显示的是数据库内全部记录数量，因此执行模拟数据、浏览器测试或人工录入后会高于固定种子数量。

`graph:benchmark` 在一次性 PostgreSQL 中生成 100,000 个事件、500,000 条关系和 100,000 个案例，验证 100 节点局部图查询的 P95 不超过 2 秒；完成后自动删除基准容器，不修改开发数据库。

## 质量检查

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
```
