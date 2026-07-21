# Causality

金融因果知识库。P1-03 抽象原子事件管理和 P1-04 抽象因果关系管理均已完成人工复核。

当前可用功能：

- 浏览和搜索抽象原子事件；
- 创建、查看和编辑事件、别名及关键词；
- 创建和编辑时显示可能重复的候选事件；
- 浏览、搜索、创建、展开查看和编辑有向因果关系；
- 从已有事件中选择关系两端，人工填写 0–100 的置信度；
- 阻止自环和同方向重复关系，允许反向关系并显示提示；
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

浏览器打开 <http://127.0.0.1:5173>，首页会进入事件列表。因果关系页为 <http://127.0.0.1:5173/relations>，系统状态页为 <http://127.0.0.1:5173/system>，API 默认监听 <http://127.0.0.1:3000>。

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

## 数据库

```bash
pnpm db:migrate
pnpm db:seed
pnpm db:verify
pnpm db:simulate -- --events=1000 --relations=3000 --cases=10000 --seed=42
```

迁移可重复执行。固定种子采用稳定标识并且不会覆盖已修改的数据；模拟数据只用于开发和性能测试。`db:verify` 显示的是数据库内全部记录数量，因此执行模拟数据、浏览器测试或人工录入后会高于固定种子数量。

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
