# Causality

Causality 是一个自托管的通用因果知识库，用于维护原子事件、具体案例和有方向的因果关系，并通过局部因果图、语义检索、CSV 数据交换和 MCP 接口使用这些数据。

当前版本以桌面浏览器和共享知识库为主。多个账号拥有相同的业务权限，共同维护一套数据；账号登录、失败限流与锁定、会话管理和个人 MCP 令牌均由应用提供。

## 主要功能

- 管理原子事件及其说明、多个别名和关键词；
- 管理带置信度的有向因果关系，并用具体案例作为验证依据；
- 独立维护可被多条关系复用的具体案例；
- 从中心事件查询上游、下游或双向局部因果图；
- 使用普通搜索或本地嵌入模型进行增强语义查询；
- 手动检查和处理重复、孤立、失效关联等数据质量问题；
- 使用 Causality CSV 格式批量导入、完整导出或按因果范围导出；
- 通过 Streamable HTTP MCP Server 供外部 AI 查询、分析和受控入库；
- 保存成功的文件导入历史和 AI 导入历史；
- 使用 Docker Compose 部署 PostgreSQL、API、Web、MCP 和语义 Worker。

详细业务操作见 [用户指南](docs/user-guide.md)。MCP 客户端差异见 [MCP 客户端兼容说明](docs/mcp-client-compatibility.md)，五条标准工作流见 [MCP 工作流说明](docs/mcp-workflows.md)。

## 运行架构

| 组件                  | 用途                            | 默认暴露方式     |
| --------------------- | ------------------------------- | ---------------- |
| Web                   | 登录和日常业务页面              | `127.0.0.1:8080` |
| MCP                   | 外部 AI 的 Streamable HTTP 接口 | `127.0.0.1:8081` |
| API                   | 业务、认证和内部 MCP API        | 仅 Compose 网络  |
| Semantic Worker       | 模型下载、向量索引和语义查询    | 仅 Compose 网络  |
| PostgreSQL + pgvector | 业务数据、系统状态和向量        | 仅 Compose 网络  |

正式 `compose.yaml` 默认只适合本机或由可信反向代理接入的部署，不应直接改成公网监听后裸露到互联网。当前仓库不包含 TLS、域名、反向代理或自动备份配置。

## 从 GitHub 部署一个干净系统

以下流程会创建新的空业务数据库：数据库迁移会写入必要的系统配置，但不会写入原子事件、具体案例、因果关系或案例关联，也不会自动创建用户。

### 1. 环境要求

- Git；
- Docker Engine 或 Docker Desktop；
- Docker Compose v2；
- OpenSSL；
- 建议至少为 Docker 分配 8 GiB 内存，尤其是在下载模型或生成语义索引时。

确认命令可用：

```bash
git --version
docker --version
docker compose version
openssl version
docker context show
```

Compose 使用当前 Docker Context，不会自动切换 Colima、Docker Desktop 或其他环境。

### 2. 下载源码

```bash
git clone https://github.com/SleeplessCatty/causality.git
cd causality
```

### 3. 创建生产环境配置

生产 Compose 读取仓库根目录的 `.env`，不是 `apps/api/.env`。先复制模板并限制文件权限：

```bash
umask 077
cp .env.example .env
chmod 600 .env
```

依次执行三次下面的命令，每次都会得到一个不同的 64 位十六进制值：

```bash
openssl rand -hex 32
```

用三次结果分别替换 `.env` 中以下三项的占位内容：

```dotenv
CAUSALITY_SESSION_HMAC_KEY=<第一次 openssl rand -hex 32 的结果>
CAUSALITY_AUTH_IP_HASH_KEY=<第二次 openssl rand -hex 32 的结果>
CAUSALITY_INTERNAL_MCP_SECRET=<第三次 openssl rand -hex 32 的结果>
```

三项必须互不相同。然后执行：

```bash
openssl rand -base64 32
```

将结果替换到：

```dotenv
CAUSALITY_TOKEN_ENCRYPTION_KEY=<openssl rand -base64 32 的结果>
```

令牌加密密钥必须是 32 字节的规范 Base64，不能使用 `openssl rand -hex 32` 的结果。保留模板中的端口和日志级别即可：

```dotenv
CAUSALITY_WEB_PORT=8080
CAUSALITY_MCP_PORT=8081
CAUSALITY_LOG_LEVEL=info
```

检查 Compose 配置。成功时命令没有输出：

```bash
docker compose config --quiet
```

不要提交 `.env`。四项密钥和数据库备份应一起安全保存；升级时不要重新生成它们。

### 4. 构建并启动

```bash
docker compose up -d --build --wait
docker compose ps
```

正常情况下，`postgres`、`api`、`semantic-worker`、`mcp` 和 `web` 都会运行并通过健康检查，`migrate` 完成后退出属于正常状态。

查看日志：

```bash
docker compose logs --tail=100
docker compose logs -f api mcp semantic-worker web
```

确认数据库结构和业务数据数量：

```bash
docker compose exec api node dist/database/verify.js
```

全新部署的原子事件、具体案例、因果关系和案例关联数量应为 0。不要运行 `seed`、`pnpm db:seed` 或 `pnpm db:simulate`；这些命令只用于开发和自动化测试。

### 5. 创建首个用户

```bash
docker compose exec api node dist/commands/userAdmin.js create
```

命令会询问用户名，并只显示一次临时密码。打开 <http://127.0.0.1:8080>，使用该用户名和临时密码登录；首次登录会直接要求设置新密码，不需要再次输入临时密码。

新密码要求 12–128 个字符，不能与用户名相同，不能是内置常见密码，也不能由同一个字符重复组成。

### 6. 首次使用

登录后可以直接创建原子事件、具体案例和因果关系。需要增强语义查询时，打开“参数配置”，选择模型并等待下载、校验、加载和索引完成。模型首次下载需要访问 Hugging Face；下载完成后可离线运行。

需要 MCP 时，在“参数配置 → MCP 服务”创建个人令牌，并复制当前客户端所需的 Streamable HTTP JSON 配置。默认地址为 <http://127.0.0.1:8081/mcp>。

## 账号管理

所有账号共享同一套因果知识库并拥有相同业务权限。以下命令在服务器终端运行：

```bash
# 创建账号
docker compose exec api node dist/commands/userAdmin.js create

# 列出账号
docker compose exec api node dist/commands/userAdmin.js list

# 重置密码；新临时密码只显示一次，用户下次登录必须修改
docker compose exec api node dist/commands/userAdmin.js reset-password

# 停用、启用或解除登录锁定
docker compose exec api node dist/commands/userAdmin.js disable
docker compose exec api node dist/commands/userAdmin.js enable
docker compose exec api node dist/commands/userAdmin.js unlock
```

停用账号会撤销其 Web 会话并删除其个人 MCP 令牌。

## 停止、重启与删除

停止并移除容器，不删除数据：

```bash
docker compose down
```

重新启动：

```bash
docker compose up -d --build --wait
```

下面的命令会永久删除数据库、向量索引和模型文件，无法恢复。只应在明确需要完全重建空系统时执行：

```bash
docker compose down --volumes --remove-orphans
```

## 数据持久化与备份

Compose 使用两个命名卷：

- `causality-postgres-data`：账号、业务数据、系统配置、AI/CSV 导入历史、个人令牌密文和向量索引；
- `causality-semantic-models`：已下载的模型文件。

`docker compose down` 不会删除它们。模型卷属于可重新下载的缓存，PostgreSQL 和根目录 `.env` 才是必须备份的核心数据。

创建数据库备份：

```bash
mkdir -p backups
chmod 700 backups
docker compose exec -T postgres \
  pg_dump -U causality -d causality --format=custom --no-owner --no-acl \
  > "backups/causality-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

将生成的 `.dump` 文件和 `.env` 一起复制到受保护的离线位置。当前仓库没有自动备份、定时恢复验证或一键恢复脚本；重要部署应先在独立环境验证备份可恢复，再执行版本升级。

密钥影响：

- 更换 `CAUSALITY_SESSION_HMAC_KEY` 会使已有 Web 会话失效；
- 更换 `CAUSALITY_AUTH_IP_HASH_KEY` 会改变登录来源哈希；
- API 与 MCP 必须使用相同的 `CAUSALITY_INTERNAL_MCP_SECRET`；
- 丢失 `CAUSALITY_TOKEN_ENCRYPTION_KEY` 后，既有个人令牌可能仍能认证，但不能再查看或复制，只能删除并重新创建。

## 升级

升级前先备份数据库和 `.env`，然后执行：

```bash
git pull --ff-only
docker compose up -d --build --wait --remove-orphans
docker compose ps
docker compose exec api node dist/database/verify.js
```

Compose 会先等待 PostgreSQL 就绪，再自动执行全部待应用迁移；API、Worker、MCP 和 Web 只会在迁移成功后启动。升级时继续使用原来的四项密钥。

## 配置项

| 变量                             | 必填 | 格式或默认值              | 用途                       |
| -------------------------------- | ---- | ------------------------- | -------------------------- |
| `CAUSALITY_SESSION_HMAC_KEY`     | 是   | `openssl rand -hex 32`    | Web 会话签名               |
| `CAUSALITY_AUTH_IP_HASH_KEY`     | 是   | `openssl rand -hex 32`    | 登录来源保护性哈希         |
| `CAUSALITY_INTERNAL_MCP_SECRET`  | 是   | `openssl rand -hex 32`    | API 与 MCP 的内部认证      |
| `CAUSALITY_TOKEN_ENCRYPTION_KEY` | 是   | `openssl rand -base64 32` | 可恢复个人 MCP 令牌加密    |
| `CAUSALITY_WEB_PORT`             | 否   | `8080`                    | Web 本机回环端口           |
| `CAUSALITY_MCP_PORT`             | 否   | `8081`                    | MCP 本机回环端口           |
| `CAUSALITY_LOG_LEVEL`            | 否   | `info`                    | API 和语义 Worker 日志级别 |

修改端口后重新运行 `docker compose up -d --build --wait`。正式 Compose 仍只监听 `127.0.0.1`。

## MCP 与外部 AI

Causality 发布 15 个 Tool、5 个 Prompt 和 4 个 Resource。Tool 提供跨客户端的查询、证据读取、候选对比、方案生成和受控提交能力；Prompt、仓库 Skill 和普通语言规则负责稳定工作流。

个人令牌按用户创建，默认隐藏，可以在列表中查看、复制令牌、复制完整 JSON 配置或撤销。撤销会直接删除令牌并使后续请求失效。不要把令牌写入 Git、公开日志、截图或聊天内容。

MCP 采集内部使用 JSON，不使用 CSV。外部 AI 从会话提取与主线有关的候选，自动完成库内对比和质量门禁，生成可读入库方案；只有用户明确确认最新完整方案后，服务端才会事务提交。分析事件、追踪路径、审查因果链和推测结果均为只读流程。

## CSV 数据交换

文件导入和导出使用 Causality CSV 格式，与 MCP JSON 入库是两条独立路线。CSV 为 UTF-8、无表头、逗号分隔，所有字段必须使用 ASCII 双引号包裹：

```csv
"原子事件","事件名称","事件说明","别名1;别名2","关键词1;关键词2"
"具体案例","案例内容"
"因果关系","原因事件名称","结果事件名称","70","关系说明","具体案例1","具体案例2"
```

CSV 导入只新增或严格复用已有记录，不修改已有数据；格式和确定性关联通过后事务入库。导入不会判断事实真实性、事件原子性或因果关系合理性，导入后应通过“数据维护”执行检查。

全字段双引号只能保证解析正确，不能阻止电子表格软件执行公式。不要用 Excel、LibreOffice 等软件直接打开来源不可信的 CSV；优先使用不会执行公式的纯文本编辑器。

## 源码开发

源码开发需要 Node.js `24.18.0`、pnpm `11.15.1` 和 Docker：

```bash
corepack enable
pnpm install
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/semantic-worker/.env.example apps/semantic-worker/.env
cp apps/mcp/.env.example apps/mcp/.env
docker compose -f compose.yaml -f compose.dev.yaml up -d --wait postgres
pnpm db:migrate
pnpm dev
```

根 `.env` 中的四个占位值仍需按正式部署第 3 步生成并替换；它供 Compose 插值使用。
三个 `apps/*/.env` 只供宿主机上的源码进程使用。

`compose.dev.yaml` 不是独立部署文件；它必须叠加在 `compose.yaml` 上，只额外把 PostgreSQL 发布到 `127.0.0.1:5432`，并为开发进程提供覆盖配置。生产部署只使用 `compose.yaml` 和根目录 `.env`。

开发地址：Web <http://127.0.0.1:5173>、API <http://127.0.0.1:3000>、Semantic Worker `127.0.0.1:3100`、MCP <http://127.0.0.1:8081/mcp>。

常用验证：

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:compose
pnpm build
```

自动化测试及其必要 fixture 保留在源码仓库中，用于确保任何克隆都能复现构建和验证；它们不会在正式 Compose 启动时写入生产数据库。固定种子和压力模拟只有显式执行开发命令时才会运行。

## 当前边界

- 业务记录采用不可恢复的永久删除，不提供软删除或业务字段版本历史；
- 置信度支持人工基准，并在案例关联数量变化时自动调整，但系统不判断案例真实性；
- 本地嵌入模型只负责检索、查重和候选比较，不生成事实或自动证明因果关系；
- 应用不内置在线 AI API 或网页搜索，外部资料获取由 MCP 客户端负责；
- AI 历史只保存成功事务，不保存完整会话、网页来源、失败方案或模型推理；
- 局部因果图最多返回 100 个关联节点；
- Web 暂不适配移动端；
- 当前仓库不提供自动备份、监控告警、TLS 或可直接公网暴露的云部署模板。
