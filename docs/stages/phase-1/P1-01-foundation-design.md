# P1-01 项目基础与质量门禁设计

版本：V1.0  
日期：2026-07-20  
状态：已完成  
所属路线图步骤：P1-01 项目基础与质量门禁

## 1. 目标

建立一个可以稳定继续开发的前后端分离 Monorepo，并验证以下最小链路：

```text
浏览器中的 React 页面
→ 调用 Fastify API
→ API 检查 PostgreSQL 连接
→ 页面显示服务状态
```

本步骤完成后，项目应该具备统一的安装、开发、检查、测试和构建命令。后续业务步骤不再重复搭建基础工具链。

## 2. 非目标

本步骤不实现：

- 抽象原子事件、事件别名、抽象因果关系和具体因果案例数据表；
- 数据库迁移和业务种子数据；
- 事件、关系和案例的 CRUD；
- 局部因果图；
- 用户登录和权限；
- Web/API 生产 Docker 镜像；
- AI、向量搜索或自动导入；
- 移动端适配；
- 完整产品导航和视觉设计。

数据库业务模型和迁移属于 P1-02；Web、API 的生产容器化属于 P1-10。

## 3. 技术与版本

本步骤只安装基础工程实际需要的依赖，版本必须精确锁定：

### 3.1 根环境

| 技术       |    版本 |
| ---------- | ------: |
| Node.js    | 24.18.0 |
| pnpm       | 11.15.1 |
| TypeScript |   6.0.2 |
| PostgreSQL |    18.4 |

### 3.2 Web

| 依赖                  |    版本 |
| --------------------- | ------: |
| react                 |  19.2.7 |
| react-dom             |  19.2.7 |
| vite                  |   8.1.5 |
| @vitejs/plugin-react  |   6.0.3 |
| react-router          |   8.2.0 |
| @tanstack/react-query | 5.101.3 |
| zod                   |   4.4.3 |
| tailwindcss           |   4.3.3 |
| @tailwindcss/vite     |   4.3.3 |

React Hook Form、Cytoscape、ELK 和 Lucide 在实际使用它们的后续步骤再安装，P1-01 不提前加入未使用依赖。

### 3.3 API

| 依赖                      |   版本 |
| ------------------------- | -----: |
| fastify                   | 5.10.0 |
| zod                       |  4.4.3 |
| fastify-type-provider-zod |  7.0.0 |
| @fastify/cors             | 11.3.0 |
| pg                        | 8.22.0 |
| dotenv                    | 17.4.2 |
| tsx                       | 4.23.1 |
| pino-pretty               | 13.1.3 |

Swagger、Drizzle 和 Drizzle Kit 在 P1-02 建立正式数据模型和接口约定时引入，P1-01 不生成空的业务 API 文档。

### 3.4 质量工具

| 依赖                   |    版本 |
| ---------------------- | ------: |
| vitest                 |  4.1.10 |
| @testing-library/react |  16.3.2 |
| happy-dom              | 20.11.0 |
| @playwright/test       |  1.61.1 |
| testcontainers         |  12.0.4 |
| eslint                 |  10.7.0 |
| typescript-eslint      |  8.64.0 |
| prettier               |   3.9.5 |

## 4. Monorepo 结构

计划创建以下结构：

```text
causality/
├── apps/
│   ├── web/
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── App.tsx
│   │   │   │   ├── AppProviders.tsx
│   │   │   │   └── router.tsx
│   │   │   ├── features/
│   │   │   │   └── system-status/
│   │   │   │       ├── SystemStatus.tsx
│   │   │   │       ├── SystemStatus.test.tsx
│   │   │   │       └── systemStatusApi.ts
│   │   │   ├── styles/
│   │   │   │   └── global.css
│   │   │   ├── test/
│   │   │   │   └── setup.ts
│   │   │   └── main.tsx
│   │   ├── index.html
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   └── vitest.config.ts
│   └── api/
│       ├── src/
│       │   ├── config/
│       │   │   └── env.ts
│       │   ├── database/
│       │   │   ├── pool.ts
│       │   │   └── readiness.ts
│       │   ├── routes/
│       │   │   ├── health.ts
│       │   │   └── readiness.ts
│       │   ├── app.ts
│       │   └── server.ts
│       ├── test/
│       │   ├── health.test.ts
│       │   └── readiness.integration.test.ts
│       ├── .env.example
│       ├── package.json
│       ├── tsconfig.json
│       └── vitest.config.ts
├── packages/
│   └── contracts/
│       ├── src/
│       │   ├── health.ts
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
├── tests/
│   └── e2e/
│       └── foundation.spec.ts
├── .editorconfig
├── .gitignore
├── .npmrc
├── .prettierignore
├── .prettierrc.json
├── compose.yaml
├── eslint.config.js
├── package.json
├── playwright.config.ts
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── README.md
```

### 4.1 结构约束

- `apps/web` 不得直接访问 PostgreSQL。
- `apps/api` 不得导入 React 或浏览器代码。
- `packages/contracts` 只能保存请求、响应、枚举和 Zod Schema，不保存数据库连接、页面组件或业务状态。
- 根目录只负责工作区配置、统一命令和跨应用测试。
- 每个源文件保持单一职责；健康检查、数据库就绪检查和服务启动不能全部写在一个文件中。

## 5. 包管理和版本锁定

根 `package.json` 固定：

```json
{
  "private": true,
  "packageManager": "pnpm@11.15.1",
  "engines": {
    "node": "24.18.0"
  }
}
```

`.npmrc` 使用精确版本保存：

```text
save-exact=true
strict-peer-dependencies=true
```

必须提交 `pnpm-lock.yaml`。依赖升级只能作为明确的维护步骤进行，开发功能时不得顺便升级依赖。

## 6. 根目录统一命令

根目录提供：

| 命令                    | 行为                         |
| ----------------------- | ---------------------------- |
| `pnpm dev`              | 并行启动 Web 和 API 开发服务 |
| `pnpm dev:web`          | 只启动 Vite                  |
| `pnpm dev:api`          | 只启动 Fastify               |
| `pnpm lint`             | 检查全部工作区代码           |
| `pnpm format:check`     | 检查格式但不自动修改         |
| `pnpm format`           | 格式化项目代码               |
| `pnpm typecheck`        | 检查全部 TypeScript 项目     |
| `pnpm test`             | 运行不依赖外部服务的单元测试 |
| `pnpm test:integration` | 运行 PostgreSQL 集成测试     |
| `pnpm test:e2e`         | 运行 Playwright 浏览器测试   |
| `pnpm build`            | 构建 contracts、API 和 Web   |

`pnpm test` 不应隐式依赖开发数据库；数据库相关测试只放入 `test:integration`。

## 7. PostgreSQL 开发环境

P1-01 的 `compose.yaml` 只定义 PostgreSQL：

```text
服务名：postgres
镜像：postgres:18.4
容器端口：5432
宿主机默认端口：5432
数据库：causality
开发用户：causality
持久化卷：causality_postgres_data
健康检查：pg_isready
```

数据库密码从本地环境变量或 Compose 开发默认值读取；`.env` 不提交，`.env.example` 只提供无敏感信息的示例。

P1-01 只执行 `SELECT 1` 验证连接，不创建业务表。Testcontainers 集成测试使用独立临时 PostgreSQL，不复用开发数据库。

## 8. API 设计

API 默认监听：

```text
http://localhost:3000
```

### 8.1 `GET /api/health`

用途：进程存活检查，不访问数据库。

成功响应：

```json
{
  "status": "ok",
  "service": "causality-api"
}
```

状态码：`200`。

### 8.2 `GET /api/ready`

用途：检查 API 是否可以访问 PostgreSQL。

数据库可用：

```json
{
  "status": "ready",
  "database": "available"
}
```

状态码：`200`。

数据库不可用：

```json
{
  "status": "not_ready",
  "database": "unavailable"
}
```

状态码：`503`。

响应不得返回数据库地址、用户名、密码、异常堆栈或驱动原始错误。

### 8.3 应用和服务启动分离

`app.ts` 负责构建和配置 Fastify 实例，`server.ts` 只负责监听端口和处理关闭信号。测试使用 `app.ts` 的实例注入请求，不在测试中占用固定端口。

### 8.4 环境变量

API环境变量：

| 变量           | 必填 | 默认值                  |
| -------------- | ---- | ----------------------- |
| `NODE_ENV`     | 否   | `development`           |
| `HOST`         | 否   | `127.0.0.1`             |
| `PORT`         | 否   | `3000`                  |
| `DATABASE_URL` | 是   | 无                      |
| `LOG_LEVEL`    | 否   | `info`                  |
| `CORS_ORIGIN`  | 否   | `http://localhost:5173` |

启动时使用 Zod 一次性校验环境变量。缺少 `DATABASE_URL` 时立即退出，并显示不包含敏感值的清晰错误。

## 9. Web 基础页面设计

Web默认监听：

```text
http://localhost:5173
```

页面只验证应用基础链路，不提前设计正式产品首页：

```text
┌──────────────────────────────────────────────────────┐
│ Causality                                            │
├──────────────────────────────────────────────────────┤
│                                                      │
│ 金融因果知识库                                       │
│                                                      │
│ 系统状态                                             │
│ API服务                          正常                 │
│ PostgreSQL                       就绪                 │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### 9.1 页面行为

- 页面加载后请求 `/api/health` 和 `/api/ready`。
- 请求期间显示“检查中”。
- API存活时显示“正常”。
- 数据库可用时显示“就绪”。
- API不可访问时显示“无法连接”。
- API可访问但数据库不可用时显示“数据库不可用”。
- 页面提供“重新检查”按钮。
- 错误状态不得显示原始堆栈、连接字符串或内部异常。

### 9.2 Vite开发代理

开发环境中，浏览器始终请求同源相对路径 `/api/...`。Vite把 `/api` 转发到 `http://localhost:3000`，不在组件中硬编码API域名。

生产反向代理在P1-10设计，本步骤不创建Nginx配置。

### 9.3 页面样式范围

- 只支持桌面端，最小人工验收视口为 `1280 × 720`。
- 建立字体、背景、正文、边框和状态色基础变量。
- 页面保持专业、克制和清晰。
- 不实现移动端导航、暗色模式、动画系统或最终品牌设计。

## 10. 共享契约

`packages/contracts` 在本步骤只定义：

```text
HealthResponse
ReadinessResponse
```

前端使用共享Schema解析API响应，不能直接把未知JSON断言成TypeScript类型。后续业务请求和响应在对应业务步骤中逐步加入，不提前定义空接口。

## 11. 错误处理和关闭流程

### 11.1 API

- 未处理错误记录结构化日志；
- 客户端只收到通用错误响应；
- 日志不得记录数据库密码和完整 `DATABASE_URL`；
- 收到 `SIGINT` 或 `SIGTERM` 时停止接收新请求、关闭数据库连接池，再退出进程；
- 数据库暂时不可用时 `/api/health` 仍返回200，`/api/ready` 返回503。

### 11.2 Web

- API请求必须有超时或可取消机制；
- 组件卸载后不得更新已卸载状态；
- 状态检查失败不能导致整个React应用崩溃；
- 用户可以手动重新检查。

## 12. 自动化测试设计

### 12.1 Contracts

- 有效健康响应可以通过Schema；
- 缺少字段或非法状态值时校验失败。

### 12.2 API单元测试

- `/api/health` 返回200和固定结构；
- 健康检查不依赖数据库；
- 未知路由返回404；
- 环境变量缺失时配置校验失败；
- 对外错误响应不泄露内部异常。

### 12.3 API集成测试

使用Testcontainers启动PostgreSQL 18.4：

- 数据库可用时 `/api/ready` 返回200；
- 数据库连接被关闭后返回503；
- 测试结束后连接池和容器正确释放。

### 12.4 Web组件测试

- 初始显示“检查中”；
- 健康和就绪接口成功时显示“正常/就绪”；
- API失败时显示“无法连接”；
- 数据库返回503时显示“数据库不可用”；
- 点击“重新检查”会再次请求。

### 12.5 Playwright冒烟测试

- 页面在 `1280 × 720` 打开；
- 页面标题和“金融因果知识库”可见；
- API和数据库状态显示正常；
- 刷新页面后仍可正确检查状态；
- 浏览器控制台没有未处理错误；
- 保存一张桌面端基准截图，作为后续页面结构变化的参考，不建立严格像素级视觉门禁。

### 12.6 构建验证

- `contracts` 类型检查通过；
- API编译通过；
- Web生产构建成功；
- 生产构建不包含服务端环境变量或数据库连接字符串。

## 13. 自动化完成标准

P1-01实现后必须执行：

```text
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
```

完成标准：

- 全部命令退出码为0；
- 没有跳过的P1-01关键测试；
- 没有TypeScript错误；
- 没有ESLint错误；
- Web和API构建成功；
- Playwright没有浏览器控制台错误。

## 14. 人工复核清单

自动化测试通过后，用户按以下步骤验收：

1. 确认本机Node为24.18.0、pnpm为11.15.1。
2. 执行 `docker compose up -d postgres`。
3. 执行 `pnpm dev`。
4. 打开 `http://localhost:5173`。
5. 确认页面在桌面浏览器中无明显错位。
6. 确认API状态显示“正常”。
7. 确认PostgreSQL状态显示“就绪”。
8. 点击“重新检查”，确认状态刷新正常。
9. 停止PostgreSQL容器，确认页面重新检查后显示“数据库不可用”，但页面本身仍可操作。
10. 重新启动PostgreSQL并检查恢复为“就绪”。
11. 检查页面和终端没有暴露数据库密码或连接字符串。

只有用户明确确认以上人工复核通过，P1-01才可标记为完成。

## 15. 预计创建和修改的文件

### 15.1 创建

- 第4节列出的Monorepo基础文件；
- Web系统状态页面和测试；
- API健康与就绪接口和测试；
- contracts健康响应契约；
- PostgreSQL开发Compose配置；
- Playwright冒烟测试；
- 根README开发说明。

### 15.2 修改

- `docs/superpowers/plans/2026-07-20-causality-application-roadmap.md`：仅更新P1-01状态；
- 本设计文档：根据用户审核意见修改状态和内容。

### 15.3 不修改

- 现有历史设计、工具研究和指南文档；
- 任何尚未创建的业务代码。

## 16. 风险与控制

| 风险                       | 控制方式                                            |
| -------------------------- | --------------------------------------------------- |
| 一开始安装过多依赖         | 只安装P1-01实际使用的包                             |
| Web和API类型漂移           | 使用最小contracts共享Schema                         |
| 单元测试误用开发数据库     | 数据库测试只放入integration命令并使用Testcontainers |
| 环境变量泄露到Web          | Web只使用相对 `/api`，构建检查敏感字符串            |
| Docker范围膨胀             | P1-01只容器化PostgreSQL，Web/API生产镜像留到P1-10   |
| 基础页面被误当成最终视觉稿 | 明确其只用于验证工程链路                            |

## 17. 审核决策

用户审核时重点确认：

1. P1-01是否只完成工程基础，没有夹带业务功能；
2. `apps/web`、`apps/api`、`packages/contracts`边界是否合理；
3. PostgreSQL是否只在开发阶段使用Compose启动；
4. 健康检查页面是否足以完成人工验收；
5. 自动化测试和人工复核是否覆盖基础链路。

设计批准后才进入开发。开发完成后必须先自动化验证，再由用户执行人工复核。
