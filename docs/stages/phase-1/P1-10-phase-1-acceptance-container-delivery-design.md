# P1-10 第一阶段整体验收与容器化交付设计

版本：V1.0
日期：2026-07-21
状态：已完成（人工验收通过：2026-07-22）
所属路线图步骤：P1-10 第一阶段整体验收与容器化交付
前置步骤：P1-01 至 P1-09 已完成开发、自动化测试、人工验收和提交

## 1. 目标

将第一阶段已有功能作为一个可重复构建、可从空数据库启动、可验证数据持久化的本机单用户应用交付。用户在仓库根目录执行一条 Docker Compose 命令，即可获得完整的 Web、API 和 PostgreSQL 生产环境，并通过一个浏览器入口使用应用。

P1-10 不增加业务功能。它负责将 P1-01 至 P1-09 的功能组合为完整交付物，补齐生产镜像、容器编排、初始化、健康检查、生产烟雾测试、运维说明和第一阶段总体验收。

## 2. 非目标

P1-10 不实现：

- 公网、域名、HTTPS 或云平台部署；
- 账号、权限、多人协作或远程访问；
- 外部镜像仓库发布；
- Kubernetes 或其他编排平台；
- 自动备份、恢复或跨机器迁移工具；
- 数据删除、修改历史或审计；
- AI、语义搜索或自动因果推断；
- 移动端适配；
- 新业务页面、API、数据库实体或图能力；
- 超过 100 个关联节点的整体因果图。

## 3. 已确认决策

- 部署仅供本机使用。
- 宿主机只暴露 Web 入口，API 和 PostgreSQL 仅在 Compose 网络中访问。
- 生产入口为 `http://127.0.0.1:8080`。
- `compose.yaml` 默认启动完整生产应用。
- Web、API 镜像从当前仓库源码在本机构建，不依赖外部业务镜像仓库。
- Web 使用 Nginx 提供静态文件并反向代理 `/api`。
- API 使用 Node.js 运行现有 Fastify 服务。
- PostgreSQL 使用命名卷持久化数据。
- 空库首次启动自动迁移，但不自动写入示例业务数据。
- 固定示例数据保留为用户显式执行的可选任务。
- 本机交付零配置，不要求复制 `.env`。
- 现有完整回归保留，并新增生产 Compose 烟雾测试。
- 新增 `compose.dev.yaml`，仅为源码开发和现有 E2E 暴露回环数据库端口。
- P1-10 人工验收通过后，第一阶段才整体完成。

## 4. 当前状态与交付缺口

当前 `compose.yaml` 只启动 PostgreSQL，并将 `5432` 映射到宿主机。Web 和 API 通过 `pnpm dev` 在宿主机运行；迁移和种子需要单独执行；E2E 使用开发服务器而不是生产镜像。

P1-10 需要补齐：

- Web 和 API 的多阶段生产 Dockerfile；
- Nginx 静态文件、React Router 回退和 API 代理配置；
- 完整生产 Compose 服务及依赖顺序；
- 迁移和可选种子一次性任务；
- Web、API、PostgreSQL 健康检查；
- 开发数据库端口覆盖文件；
- 生产 Compose 独立烟雾测试；
- 生产、开发、运维、验收和限制说明。

## 5. 总体架构

```text
浏览器 http://127.0.0.1:8080
                  │
                  ▼
          Web 容器 / Nginx
          ├── React 静态文件
          ├── 路由回退到 index.html
          └── /api/* 反向代理
                  │
                  ▼
          API 容器 / Node.js
                  │
                  ▼
         PostgreSQL 容器 + 命名卷

PostgreSQL 健康 ──► migrate 一次性任务 ──► API 启动 ──► Web 启动
                                      └── seed 可选任务（仅手工执行）
```

长期运行的生产容器只有 `web`、`api` 和 `postgres`。`migrate` 是每次 Compose 启动时必须成功完成的一次性任务；`seed` 只在用户明确指定时运行。

## 6. 服务职责与依赖

### 6.1 PostgreSQL

- 使用现有明确版本的 PostgreSQL Alpine 镜像；
- 使用 Compose 内置的本机专用数据库名和账号；
- 数据目录挂载到项目范围内的命名卷；
- 生产 Compose 不声明宿主机端口；
- 使用 `pg_isready` 检查数据库可接受连接；
- 迁移、API 和种子通过服务名 `postgres` 连接。

### 6.2 migrate

- 复用 API 生产镜像，不单独维护第四份构建逻辑；
- 数据库健康后执行现有 Drizzle 迁移；
- 迁移必须保持幂等，空库和已升级数据库都可安全执行；
- 成功后以退出码 0 结束；
- 失败时以非零退出码结束，阻止 API 启动；
- 不执行固定种子，不修改业务数据。

### 6.3 API

- 在多阶段构建中编译 TypeScript；
- 运行镜像只保留生产依赖、编译产物和迁移运行所需文件；
- 使用现有 Fastify `start` 入口；
- 只监听容器网络，不映射宿主机端口；
- 在 `migrate` 成功后启动；
- `/api/health` 必须同时反映 HTTP 服务和数据库可用性；
- 收到 `SIGTERM` 时沿用现有优雅关闭逻辑。

### 6.4 Web

- 在多阶段构建中生成 Vite 生产静态资源；
- 运行镜像只包含 Nginx 和静态资源；
- 将 `/api/*` 代理到 `api` 服务，浏览器不需要跨域配置；
- 未匹配的页面路径回退到 `index.html`，支持事件、关系、案例、因果图和系统状态页面直接刷新；
- 对静态资源设置合理缓存，对 `index.html` 避免长期陈旧缓存；
- 提供容器自身的轻量健康检查路径；
- 只绑定宿主机 `127.0.0.1:${CAUSALITY_WEB_PORT:-8080}`。

### 6.5 seed

- 复用 API 生产镜像；
- 放入非默认 `tools` Profile，默认 Compose 启动不运行；
- 用户执行 `docker compose run --rm seed` 时才加载现有固定示例数据；
- 保持现有稳定标识和幂等规则；
- 再次执行不得重复增加固定记录或覆盖用户已经修改的固定记录。

## 7. 启动、就绪与重启策略

标准启动命令：

```bash
docker compose up -d --build --wait
```

就绪顺序：

1. PostgreSQL 启动并通过健康检查。
2. `migrate` 执行并成功退出。
3. API 启动并通过包含数据库检查的健康检查。
4. Web 启动并通过自身健康检查。
5. Compose 报告整体启动成功。

`web`、`api` 和 `postgres` 使用 `unless-stopped` 重启策略。`migrate` 和 `seed` 是一次性任务，不使用自动重启循环。

启动失败规则：

- PostgreSQL 不健康：迁移不开始；
- 迁移失败：API 和 Web 不进入就绪状态；
- API 不健康：Web 不进入整体就绪状态；
- Web 不健康：Compose `--wait` 失败；
- 任一失败都保留数据库卷，不自动删除或重建数据。

## 8. 网络与配置

生产环境仅有一个浏览器入口：

```text
http://127.0.0.1:8080
```

浏览器对 API 的请求继续使用相对路径 `/api`。Nginx 负责内部代理，因此生产环境不需要 CORS；API 仍保留现有 CORS 配置以支持源码开发。

零配置默认值只用于本机隔离网络。Compose 允许通过环境变量覆盖 Web 宿主端口和日志级别，但基本启动不依赖 `.env`。数据库账号不视为公网凭据，因为 PostgreSQL 不暴露端口且该交付明确限定为本机单用户使用。

Compose 使用当前活动的 Docker Context，不设置固定 `DOCKER_HOST`，兼容 Colima 和 Docker Desktop。

## 9. 镜像构建约束

- Node 构建阶段与项目要求的 Node.js 24.18.0 和 pnpm 11.15.1 对齐；
- 基础镜像使用明确版本标签，不使用 `latest`；
- API 和 Web 使用独立多阶段 Dockerfile；
- 依赖安装必须使用现有 lockfile 的冻结模式；
- 利用工作区文件分层提高未修改依赖时的构建缓存命中；
- API 运行进程和 Nginx 使用其镜像支持的非 root 用户；
- `.dockerignore` 排除 `.git`、本地 `node_modules`、各应用 `dist`、测试结果、覆盖率、日志和编辑器临时文件；
- 不把本地 `.env`、数据库数据或测试截图复制进镜像；
- 镜像不安装测试、浏览器或 Testcontainers 运行环境。

## 10. 数据生命周期

### 10.1 空库

首次生产启动时自动创建数据库结构，业务表为空。用户打开 Web 应用后自行录入第一条事件、关系和案例。

### 10.2 普通停止和升级

以下操作必须保留命名卷：

```bash
docker compose down
docker compose up -d --build --wait
```

每次升级先执行幂等迁移，再启动新 API。P1-10 不设计自动回滚；迁移失败时保留旧数据和错误日志，由用户停止升级并检查原因。

### 10.3 示例数据

固定示例数据不是生产启动条件，只通过显式 `seed` 任务加载。README 必须说明这是可选演示数据，并且会在当前数据库中增加固定事件、关系和案例。

### 10.4 完全重置

删除命名卷会永久删除事件、关系和案例。重置命令只能放在单独的危险操作章节，必须明确说明不可恢复，并与普通停止命令分开。

## 11. 源码开发兼容

生产 `compose.yaml` 不暴露 PostgreSQL。新增 `compose.dev.yaml` 仅为 `postgres` 添加：

```text
127.0.0.1:5432 -> postgres:5432
```

源码开发启动方式：

```bash
docker compose -f compose.yaml -f compose.dev.yaml up -d --wait postgres
pnpm dev
```

现有需要宿主机连接数据库的 E2E 和数据库工具同步使用开发覆盖文件。开发覆盖不得改变生产 Web/API 配置，也不得成为生产启动的必需文件。

## 12. 日常操作与故障定位

README 提供以下主流程：

```bash
# 启动或升级
docker compose up -d --build --wait

# 查看状态
docker compose ps --all

# 查看日志
docker compose logs -f web api migrate postgres

# 停止但保留数据
docker compose down

# 可选加载示例数据
docker compose run --rm seed
```

故障排查按启动链从前到后进行：

1. `postgres` 是否健康；
2. `migrate` 是否以 0 退出；
3. `api` 是否健康且可连接数据库；
4. `web` 是否可响应 `/health`；
5. 浏览器通过 `/api/health` 是否取得完整系统状态。

API 不可用时，Nginx 对 `/api` 返回真实的网关失败，不生成业务成功响应。Web 静态页面可能仍可加载，但系统状态必须显示 API 或数据库不可用。

## 13. 自动化测试

### 13.1 现有完整回归

P1-10 保持并执行：

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
```

现有单元、数据库集成和 10 项浏览器回归继续验证 P1-01 至 P1-09 的业务行为。

### 13.2 Compose 静态检查

- `docker compose config` 可解析；
- 使用开发覆盖文件时配置也可解析；
- 服务依赖没有循环；
- 生产配置只暴露 Web 端口；
- Web、API、PostgreSQL 都声明健康检查；
- `migrate` 是 API 的成功前置条件；
- `seed` 不属于默认启动集合。

### 13.3 生产烟雾测试

新增命令：

```bash
pnpm test:production
```

烟雾测试必须使用唯一 Compose 项目名、专用命名卷和测试端口 `127.0.0.1:18080`，不得连接或清理默认开发项目。流程为：

1. 从空专用卷构建并启动生产应用；
2. 等待所有长期服务健康且迁移成功；
3. 验证 Web 首页、一个 React Router 深层链接和 `/api/health`；
4. 验证空库已迁移但没有自动固定示例数据；
5. 通过 `http://127.0.0.1:18080/api` 创建并查询一条事件；
6. 重启长期服务并确认事件仍存在；
7. 显式运行 `seed`，验证固定数据加载；
8. 再次运行 `seed`，验证固定数据数量不重复增长；
9. 检查服务状态和异常退出；
10. 无论成功或失败，都只清理该次烟雾测试创建的项目和卷。

清理逻辑必须使用脚本已解析的专用项目名和端口，不得使用默认项目名、未解析变量、通配符或广泛删除命令。

### 13.4 自动化实施记录（2026-07-22）

P1-10 实施与自动化验证结果：

- `pnpm format:check`、`pnpm lint` 和 `pnpm typecheck` 通过；
- `pnpm test` 通过：Contracts 25、API 63、Web 99，共 187 项测试；
- `pnpm test:integration` 使用一次性 PostgreSQL 通过 45 项测试；
- `pnpm test:e2e` 通过 10 项桌面浏览器测试；由于测试文件共享同一个开发数据库和图运行时，固定使用 1 个 worker，避免文件级并行互相干扰；
- `pnpm build` 完成 Contracts、API 和 Web 生产构建；Vite 仅报告既有的因果图模块 chunk 超过 500 kB 警告，不影响构建；
- `pnpm test:compose` 通过 2 项 Compose 合约测试，确认生产只暴露 Web，开发覆盖只在回环地址暴露 PostgreSQL；
- API 与 Web 生产镜像构建成功，API 使用非 root `node` 用户，Web 使用非特权 Nginx；
- `pnpm test:production` 通过 1 项隔离生产烟雾测试：从专用空卷迁移、生产页面与 API、人工创建数据、停止后重启持久化、显式种子及第二次种子幂等性均通过；专用项目结束后容器、网络和卷已清理；
- 真实默认生产拓扑中 PostgreSQL、API、Web 均为 healthy，`migrate` 以状态 0 结束；`/health`、`/api/health`、`/api/ready` 和直接刷新 `/graph` 均返回 200；
- 1280×720 真实浏览器逐页检查 `/events`、`/relations`、`/cases`、`/graph` 和 `/system`，系统状态显示 API 正常、PostgreSQL 就绪，浏览器 console 为 0 error、0 warning；
- 默认生产栈检查后执行 `docker compose down`，保留现有命名卷，未执行任何卷删除操作。

以上自动化结果与用户人工验收结果共同构成 P1-10 和第一阶段的完成依据。

## 14. 人工验收

自动化门禁通过后，用户在默认生产 Compose 上检查：

1. 从全新卷执行一条命令可启动完整应用；
2. `docker compose ps` 显示 PostgreSQL、API 和 Web 健康，迁移成功结束；
3. `http://127.0.0.1:8080` 可打开，刷新各业务深层链接不返回 404；
4. 空库不自动出现示例事件、关系或案例；
5. 可创建、搜索、查看和编辑原子事件；
6. 可创建、查看和编辑因果关系及置信度；
7. 可创建、复用和关联具体案例；
8. 可生成、扩展、筛选和操作局部因果图；
9. 系统状态页显示 Web/API/数据库正常；
10. 停止并重新启动容器后，人工录入数据仍存在；
11. 重新构建镜像并启动后，数据仍存在；
12. 显式运行 `seed` 后固定示例数据可用；
13. 普通停止不会删除命名卷；
14. 浏览器控制台和容器日志没有未解释错误。

人工验收结果：用户于 2026-07-22 明确确认上述检查通过。P1-10 和第一阶段更新为“已完成”。

## 15. 第一阶段已知限制

- 仅支持本机、单用户、HTTP 回环地址；
- 没有账号、权限和多人协作；
- 没有自动备份、恢复和跨机器迁移；
- 没有业务数据删除、版本历史和审计；
- 没有 AI、语义搜索和自动因果推断；
- 没有移动端适配；
- 局部因果图最多整体展示 100 个关联节点；
- 置信度完全由用户人工填写；
- 示例数据只由用户显式加载；
- P1-10 不提供公网安全保证。

这些限制写入 README。第二阶段只保留路线图入口，具体顺序需根据第一阶段实际使用反馈重新确认。

## 16. 第一阶段完成标准

只有同时满足以下条件，第一阶段才完成：

1. P1-01 至 P1-09 已完成人工验收；
2. P1-10 所有自动化门禁通过；
3. 生产 Compose 从空专用卷启动成功；
4. 数据迁移、持久化和显式种子加载均验证成功；
5. 用户完成 P1-10 桌面浏览器和容器重启验收；
6. 用户明确确认 P1-10 人工验收通过；
7. 设计文档、README 和路线图记录最终状态。

第一阶段完成不会自动开始第二阶段。系统需先报告完整交付结果，再询问用户是否进入第二阶段规划。

完成记录：上述 7 项条件均已满足，第一阶段于 2026-07-22 完成。第二阶段尚未开始。

## 17. 预计文件

预计新增：

```text
.dockerignore
apps/api/Dockerfile
apps/web/Dockerfile
apps/web/nginx.conf
compose.dev.yaml
scripts/test-production-compose.sh
tests/production/production-smoke.spec.ts
```

预计修改：

```text
compose.yaml
package.json
playwright.config.ts 或独立生产烟雾测试配置
README.md
docs/superpowers/plans/2026-07-20-causality-application-roadmap.md
docs/stages/phase-1/P1-10-phase-1-acceptance-container-delivery-design.md
```

生产烟雾测试固定放在 `tests/production`，不得扩大为第二套完整 E2E 套件。P1-10 不修改业务数据库 Schema、业务 API 契约或业务页面功能。

## 18. 审核重点

请重点确认：

1. 生产只暴露 `127.0.0.1:8080`；
2. 一条 Compose 命令启动完整应用；
3. 空库自动迁移但不自动写示例数据；
4. `seed` 只能显式执行；
5. 数据使用命名卷持久化，普通停止和重建不删除；
6. 迁移失败会阻止 API 和 Web 就绪；
7. Web 统一提供页面和 `/api` 入口；
8. `compose.dev.yaml` 只服务源码开发，不削弱生产隔离；
9. 生产烟雾测试使用独立项目和卷，不触碰用户数据；
10. P1-10 只完成交付和整体验收，不增加业务功能；
11. 用户确认 P1-10 后第一阶段才完成；
12. 第二阶段不会自动开始。
