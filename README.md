# Causality

金融因果知识库。P1-01 至 P1-10 均已完成开发、自动化测试和人工验收，第一阶段已完成。UX-01 紧凑桌面布局和 UX-02 详情导航、完整候选与因果图控件优化均已完成开发与自动化测试，等待人工复核。

当前可用功能：

- 使用紧凑型桌面布局和可折叠左侧导航，普通页面会记住导航栏状态；
- 浏览和搜索抽象原子事件；
- 创建、查看和编辑事件、别名及关键词；
- 创建和编辑时显示可能重复的候选事件；
- 浏览、搜索、创建、展开查看、进入独立详情页和编辑有向因果关系；
- 从已有事件中选择关系两端，人工填写 0–100 的置信度；
- 阻止自环和同方向重复关系，允许反向关系并显示提示；
- 独立浏览、搜索、创建、查看和编辑最多 50 字的具体案例；
- 在关系表单中自动读取全部匹配事件和案例，可复用已有案例或显式创建新案例；
- 一个案例可支持多条关系，关系展开显示真实案例数和最近 5 条；
- 以一个原子事件为中心查询上游、下游或双向局部因果图；
- 使用 20、50、100 节点档位限制图规模，并按最低置信度和最低案例数筛选；
- 在 Web 因果图页面搜索中心事件，以初始 20 节点档位展示有向分层图；
- 图页面通过应用内下拉控件切换双向、下游、上游，并支持 10%–200% 缩放、平移和适应画布；
- 在全画布工作区通过下拉框直接切换 20、50、100 节点上限；
- 可按离散档位设置最低置信度和最低案例数，修改后立即查询且可由 URL 恢复；
- 点击节点或关系后高亮一跳邻接内容，未关联元素保持原样；
- 使用方向键按“节点 → 关系 → 节点”沿空间方向移动选择；
- 使用空格独立开关右侧详情检查器，查看事件信息或关系案例摘要；
- 拖动节点临时调整当前位置，切换中心、方向或重新布局后恢复自动布局；
- 通过 REST API 完成相同操作；
- 查看 API 与数据库运行状态。

事件列表的别名或关键词超过直接展示范围时，鼠标悬停 2 秒可查看完整内容；每行“编辑”入口直接进入对应编辑页。因果关系列表中的原因事件、方向箭头和结果事件分别进入事件详情、关系详情和事件详情，列表展开区只保留关系说明及最近 5 条案例；关系详情页显示完整字段和全部关联案例。

## 本地要求

- Node.js 24.18.0
- pnpm 11.15.1
- Docker（包含 Compose）

## 生产容器启动

进入包含 `package.json`、`compose.yaml` 和 `apps` 的仓库根目录，一条命令构建并启动完整应用：

```bash
cd /path/to/causality
docker compose up -d --build --wait
```

浏览器打开 <http://127.0.0.1:8080>。Web 容器同时提供页面和 `/api` 反向代理；API 与 PostgreSQL 只在 Compose 内部网络访问。首次启动会自动执行数据库迁移，但不会自动写入示例业务数据。

常用操作：

```bash
# 查看容器、健康状态和已结束的迁移任务
docker compose ps --all

# 查看启动链日志
docker compose logs -f web api migrate postgres

# 停止应用但保留数据库卷
docker compose down

# 可选：显式加载固定示例数据
docker compose run --rm seed
```

Compose 使用当前活动的 Docker Context，兼容 Colima 和 Docker Desktop，不会主动切换环境。可按需覆盖本机 Web 端口和 API 日志级别：

```bash
CAUSALITY_WEB_PORT=9080 CAUSALITY_LOG_LEVEL=debug docker compose up -d --build --wait
```

### 源码开发

源码开发需要 Node.js 与 pnpm，并使用开发覆盖文件把 PostgreSQL 仅映射到本机回环地址：

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
docker compose -f compose.yaml -f compose.dev.yaml up -d --wait postgres
pnpm dev
```

开发服务器地址为 <http://127.0.0.1:5173>，API 为 <http://127.0.0.1:3000>。生产启动不需要复制 `.env`。

### 完全重置（危险操作）

以下命令会永久删除 Compose 命名卷中的全部事件、关系和案例，无法恢复。普通停止不要使用 `--volumes`：

```bash
docker compose down --volumes
```

在“因果图”页面输入事件名称或别名并选择候选项，系统会自动生成默认双向图。中心事件、方向、节点上限、最低置信度和最低案例数均保存在 URL 中，刷新、复制链接或使用浏览器前进后退都可以恢复同一查询。

因果图使用侧栏之外的全部工作区。顶部悬浮工具栏包含中心事件、方向、节点上限、最低置信度、最少案例数和缩放操作；四个查询选项修改后立即重新查询。节点上限可直接选择 20、50 或 100；切换方向会回到 20，选择新的中心事件会回到“双向、20”，两者都保留当前筛选条件。重新查询和布局期间继续显示上一张图，左下状态框显示“更新中”；失败时保留旧图并可直接重试。

图中点击节点或关系只改变选择和高亮，不会自动打开详情。画布取得焦点后，方向键在相邻节点与关系间移动，空格打开或关闭右侧悬浮检查器，`Esc` 清除选择并关闭检查器。检查器覆盖画布但不会改变画布尺寸或重新布局；点击画布空白只清除选择，关闭检查器会保留选择并把焦点返回画布。所有节点均可拖动，位置只在当前图中临时保留。

关系表单和因果图中心事件搜索在输入后先显示首批候选，再自动读取后续游标页，直至可以浏览全部匹配结果。长列表采用窗口化渲染，不显示匹配原因、分页批次或结果总数。关系表单中的案例候选在输入框上方展开；可创建新案例时，该操作固定显示在第一项。

事件 API：

- `GET /api/events`：列表、传统搜索和游标分页；
- `GET /api/events/candidates`：事件候选游标分页，单批最多 100 条；
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
- `GET /api/cases/candidates`：案例候选游标分页，单批最多 100 条；
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
pnpm test:compose
pnpm test:production
pnpm build
```

`test:production` 使用唯一命名的临时 Compose 项目、端口 18080 和专用数据卷，验证空库迁移、生产页面、API、重启持久化以及显式种子幂等性；结束后只清理该临时项目。

## 第一阶段已知限制

- 仅支持本机、单用户和 HTTP 回环地址；
- 没有账号、权限和多人协作；
- 没有自动备份、恢复和跨机器迁移工具；
- 没有业务数据删除、版本历史和审计；
- 没有 AI、语义搜索和自动因果推断；
- 没有移动端适配；
- 局部因果图最多整体展示 100 个关联节点；
- 置信度完全由用户人工填写；
- 示例数据只由用户显式加载；
- 不提供公网部署安全保证。
