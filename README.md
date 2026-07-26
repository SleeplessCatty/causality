# Causality

Causality 是一个用于人工维护原子事件、因果关系和具体案例的本地通用因果知识库。

## 核心能力

- 管理原子事件，并为事件维护多个别名、关键词和说明；
- 管理原子事件之间带置信度的有向因果关系；
- 独立记录真实发生的具体案例，并在多条因果关系中复用；
- 从中心事件生成上游、下游或双向局部因果图；
- 使用名称、别名、关键词、关系说明或案例内容进行传统搜索；
- 使用本地嵌入模型对三个主列表执行按需增强语义查询；
- 在 PostgreSQL pgvector 中维护可重建的语义向量索引；
- 通过详情页查看事件、关系和案例之间的关联依据。

## 快速开始

需要安装 Docker，并确保 Docker Compose 可用。在仓库根目录执行：

```bash
docker compose up -d --build --wait
```

浏览器打开 <http://127.0.0.1:8080>。

应用首次启动时会自动创建空数据库并执行迁移，不会自动写入示例业务数据。Web 是默认唯一暴露到本机的服务；API、语义 Worker 和 PostgreSQL 只在 Compose 内部网络访问。

## 数据与持久化

PostgreSQL 数据和模型文件分别保存在两个 Compose 命名卷中：

- `causality-postgres-data`：业务数据、配置、任务状态和可重建的向量索引；
- `causality-semantic-models`：下载后的模型文件。

停止应用不会删除业务数据、向量索引或模型：

```bash
docker compose down
```

如需加载可重复执行的固定示例数据，请显式运行：

```bash
docker compose run --rm seed
```

再次启动应用：

```bash
docker compose up -d --build --wait
```

以下命令会永久删除 Compose 命名卷及其中的全部业务数据，且无法恢复。仅在明确需要完全重置时使用：

```bash
docker compose down --volumes
```

备份时应同时备份 PostgreSQL 和模型卷。只恢复 PostgreSQL 时，业务数据不会丢失，但模型二进制不在数据库备份中，需要重新下载；只恢复模型卷也不能代替数据库备份。

## 使用说明

**原子事件**

在“原子事件”中浏览、搜索、创建和编辑事件。每个事件可包含标准名称、说明、多个别名和多个关键词。事件名称最长 50 字，单个别名最长 80 字，单个关键词最长 50 字。

**因果关系**

在“因果关系”中选择原因事件和结果事件，填写 0–100 的人工置信度，并关联已有或新建的具体案例。系统阻止自环和同方向重复关系；反向关系允许保存，并会给出提示。关系详情显示说明、案例数量和关联案例。

**具体案例**

在“具体案例”中记录一条确切发生过的真实事件，内容最长 100 字。案例可以先独立创建，也可以在关系表单中搜索、复用或新建；同一案例可以支持多条因果关系。

原子事件、因果关系和具体案例三个主列表固定每页显示 50 条，提供上一页、下一页、页码按钮、当前页、总页数、总条目数和任意页跳转。进入详情或编辑页面后返回列表，会恢复对应页码并定位原记录。

**增强语义查询**

普通搜索始终先执行且不依赖语义服务。需要模糊语义匹配时，在“原子事件”“因果关系”或“具体案例”的搜索框右侧点击“增强查询”。精确匹配结果仍排在前面，语义查询最多补充 100 条候选。

在“参数配置”中选择一个语义模型。首次选择会下载模型，校验完成后自动加载并生成全量索引；切换模型会确认后清空旧向量并为新模型重建索引，已经下载的旧模型文件会保留。每个模型分别保存相似度门槛。创建、编辑或删除业务记录后，Worker 会异步更新相关向量；普通搜索在下载、建索引、重试或 Worker 故障期间仍可使用。

- 中文轻量（`bge-small-zh-v1.5`）：约 24 MB，512 维，下载和索引最快；
- 轻量快速（`multilingual-e5-small`）：约 135 MB，384 维，适合中英文内容；
- 均衡多语言（`granite-embedding-97m-multilingual-r2`）：约 123 MB，384 维，兼顾模型体积与多语言检索；
- 质量优先（`bge-m3`）：约 586 MB，1024 维，资源占用和索引时间最高。

四个模型暂时同时保留用于真实数据对比，不代表体积更大的模型一定更适合本应用。项目内置的通用验证集重点检查同义表达、口语改写、术语解释、因果链压缩和案例改写；普通搜索仍负责精确文本，增强查询只补充语义候选。

模型下载完成后可离线查询。首次下载本身需要能够访问 Hugging Face；模型使用固定版本、文件大小和 SHA-256 校验，模型文件不会写入 Git 仓库。

**数据维护与永久删除**

三个主列表均可永久删除记录，删除后无法从应用恢复。仍被因果关系引用的原子事件不能删除；先删除关系后才可删除事件。删除因果关系只会移除该关系及其案例关联，不会删除事件或案例；删除具体案例同样不会删除关系。

“数据维护”是独立页面。点击“检查数据”才会启动一次检查；它统计孤立原子事件、无案例因果关系和孤立具体案例，并保存最近一次成功检查的快照。统计卡片可打开相应的隐藏孤立列表筛选。检查问题可逐条自动或手动标记处理；未实际修改的数据会在下一次检查中再次发现。系统状态页面仅显示运行时 API、PostgreSQL 状态和“重新检查”操作。

本阶段不提供软删除、恢复、历史记录、自动检查计划或永久忽略。

**局部因果图**

在“因果图”中搜索并选择中心事件。顶部工具栏可切换双向、下游或上游，选择 20、50 或 100 个关联节点上限，并按最低置信度和最少案例数筛选。查询参数修改后会自动重新生成并适应画布；搜索框更换中心事件会恢复默认查询参数，从详情检查器更换中心事件则保留当前参数。

画布支持平移、10%–200% 缩放、适应画布和临时拖动节点。点击节点会高亮相邻关系及另一端节点；点击关系会高亮两端节点。画布获得焦点后可用方向键在相邻元素间移动选择，按空格打开或关闭右侧检查器，按 `Esc` 清除选择并关闭检查器。

## 配置

生产 Compose 支持以下环境变量：

- `CAUSALITY_WEB_PORT`：Web 绑定到本机回环地址的端口，默认 `8080`；
- `CAUSALITY_LOG_LEVEL`：API 日志级别，默认 `info`。

示例：

```bash
CAUSALITY_WEB_PORT=9080 CAUSALITY_LOG_LEVEL=debug docker compose up -d --build --wait
```

Compose 始终使用当前活动的 Docker Context，兼容 Colima 和 Docker Desktop，不会主动切换 Docker 环境。可使用以下命令确认当前环境：

```bash
docker context ls
```

## 源码开发

源码开发需要 Node.js 24.18.0、pnpm 11.15.1 和 Docker。在仓库根目录执行：

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
cp apps/semantic-worker/.env.example apps/semantic-worker/.env
docker compose -f compose.yaml -f compose.dev.yaml up -d --wait postgres
pnpm db:migrate
pnpm dev
```

开发页面位于 <http://127.0.0.1:5173>，API 位于 <http://127.0.0.1:3000>，语义 Worker 位于本机回环地址的 `3100` 端口。根命令会同时启动 Web、API 和 Worker。开发覆盖文件只把 PostgreSQL 映射到本机回环地址；生产容器启动不需要复制 `.env`。

`compose.yaml` 定义完整生产栈和两个持久卷；`compose.dev.yaml` 只是叠加在生产文件上的开发覆盖，仅把 PostgreSQL 暴露到 `127.0.0.1:5432`，不能单独代替生产文件使用。

常用数据库命令：

```bash
pnpm db:migrate
pnpm db:seed
pnpm db:verify
pnpm db:simulate -- --events=1000 --relations=3000 --cases=10000 --seed=42
```

固定种子包含 200 个跨经济经营、软件技术、网络安全、健康生活、环境能源、教育组织、交通物流和社会农业领域的原子事件，以及 180 条因果关系和 220 条虚构案例。它用于观察普通搜索与增强查询的真实差异，不会覆盖已修改的数据。

`db:simulate` 是显式的开发压力工具，不属于初始化流程，应用和 Compose 都不会自动运行它。它生成的 `SIM-` 数据只适合性能测试，不适合语义质量评估；`db:verify` 始终显示数据库中的实际总量。

## API

Web 开发服务器和生产 Nginx 都通过同源 `/api` 提供接口：

- `/api/events`：原子事件列表、搜索、候选、详情、关联关系、创建和更新；
- `/api/relations`：因果关系列表、搜索、方向检查、详情、关联案例、创建和更新；
- `/api/cases`：具体案例列表、搜索、候选、详情、关联关系、创建和更新；
- `/api/data-checks`：手动数据检查、最近成功快照和当前问题处理；
- `/api/semantic`：模型配置、下载/索引状态、模型切换和增强查询状态；
- `/api/causal-graph`：以一个原子事件为中心查询局部因果图；
- `/api/openapi.json`：OpenAPI 文档；
- `/api/health`：API 进程存活状态，不检查数据库；
- `/api/ready`：数据库连接就绪状态。

API 没有认证机制，只应在受信任的本机环境中使用。

## 质量验证

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm test:compose
pnpm semantic:model-smoke -- multilingual-e5-small
pnpm semantic:model-smoke -- bge-small-zh-v1.5
pnpm semantic:model-smoke -- granite-embedding-97m-multilingual-r2
pnpm semantic:model-smoke -- bge-m3
pnpm semantic:quality
pnpm semantic:compare
pnpm semantic:benchmark
pnpm graph:benchmark
pnpm data-check:benchmark
pnpm test:production
pnpm build
```

集成测试、源码端到端测试、性能基准和生产烟雾测试使用隔离的临时数据库或临时 Compose 项目，不应读写开发数据库。真实模型烟雾和质量命令默认把文件缓存在 `apps/semantic-worker/.cache/semantic-models`；也可通过 `CAUSALITY_MODEL_DIRECTORY` 指定缓存目录。`semantic:compare` 会对当前已启动应用的固定示例数据轮换四个模型并重建索引，完成后恢复中文轻量模型；详细结果见 [`docs/semantic-enhanced-search-evaluation.md`](docs/semantic-enhanced-search-evaluation.md)。

语义故障排查：

1. 在“参数配置”查看下载、加载、全量索引或增量索引状态和错误；
2. 用 `docker compose ps` 确认 `postgres`、`api`、`semantic-worker`、`web` 均为 healthy；
3. 用 `docker compose logs semantic-worker` 查看下载校验、模型加载或索引错误；
4. 确认模型卷空间充足，并保留固定版本的全部文件；
5. Worker 重启会读取数据库任务状态继续处理；模型卷缺失或校验失败时需重新下载。

即使增强查询不可用，三个列表的普通搜索仍会返回结果，并在用户主动点击“增强查询”时给出不可用原因。

## 当前限制

- 面向本机单用户使用，没有账号、权限或多人协作；
- 业务记录仅支持不可恢复的永久删除，不提供软删除、恢复、修改历史或审计；
- 置信度完全由用户人工填写，不会根据案例数量自动调整；
- 语义模型只用于候选检索，不生成内容、不自动判断因果关系，也不执行因果推断；
- 局部因果图最多查询 100 个关联节点，不计算完整可达网络；
- 暂不针对移动端布局进行适配；
- 不提供自动备份、跨机器恢复、监控或告警；
- 不保证公网部署安全。

## Roadmap

- CSV/JSON 批量导入与人工审核；
- Cytoscape/ELK Web Worker、图页面资源体积和布局性能优化；
- 多段因果路径和历史案例分析；
- 备份恢复、监控、安全响应头和按需认证。
