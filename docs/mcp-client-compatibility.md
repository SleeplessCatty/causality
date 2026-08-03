# MCP 客户端兼容与诊断

## 支持基线与不保证事项

Causality 提供 15 个 Tool、5 个 Prompt、4 个 Resource。Tool 是最低通用能力；客户端即使不展示 Prompt、Resource、Skill 或斜杠命令，也应能直接调用 Tool。默认传输为 Streamable HTTP，stdio 用于兼容和调试。

本项目不保证所有客户端采用相同菜单、Prompt 展示或 Skill 发现方式，也不保证跨模型得到一致的语言理解结果。服务端保证稳定 Tool 名称、严格 Schema、结构化错误和受控写入边界。

## 生产 Compose Streamable HTTP 配置

```bash
docker compose up -d --build --wait
```

登录后在“参数配置 → MCP 服务”为客户端创建个人令牌，并从对应行复制完整配置。
默认端点为 `http://127.0.0.1:8081/mcp`。配置模板：

```json
{
  "transport": "streamable-http",
  "url": "<MCP_URL>",
  "headers": { "Authorization": "Bearer <TOKEN>" }
}
```

## Codex CLI 与 Desktop

在项目本地 `.codex/config.toml` 中配置：

```toml
[mcp_servers.causality]
url = "<MCP_URL>"
http_headers = { Authorization = "Bearer <TOKEN>" }
```

进入 `<PROJECT_PATH>` 后启动 Codex。用 `/mcp` 检查服务器与 15 个 Tool，用 `/skills` 检查 5 个 Causality Skill。Codex 的 `/mcp` 不负责展示 Prompt 和 Resource。

## Claude Code 与 Claude Desktop

Claude Code 原生支持 Streamable HTTP 与自定义请求头，是首选方式；Claude Desktop 的 `mcpServers` 只支持 stdio，远程 HTTP 需经 `mcp-remote` 桥接。两者令牌都不得写入已跟踪文件。

### Claude Code（Streamable HTTP，推荐）

在 `<PROJECT_PATH>` 下用 CLI 注册，令牌只写入本地用户配置（`~/.claude.json`），不进入仓库：

```bash
claude mcp add --scope local --transport http causality <MCP_URL> \
  --header "Authorization: Bearer <TOKEN>"
```

启动 `claude` 后用 `/mcp` 检查服务器与 15 个 Tool。5 个 Prompt 以斜杠命令 `/mcp__causality__<prompt名>` 出现；Resource 由客户端按需读取。`.agents/skills` 是 Codex 使用的 Skill，Claude Code 不发现它们，改用 Prompt 或本目录下的 Markdown 工作流。

若偏好文件方式，可在项目根创建 `.mcp.json`（含令牌，必须加入 `.gitignore`）：

```json
{
  "mcpServers": {
    "causality": {
      "type": "http",
      "url": "<MCP_URL>",
      "headers": { "Authorization": "Bearer <TOKEN>" }
    }
  }
}
```

### Claude Code（stdio）

先启动本地 API，再注册 stdio 命令：

```bash
claude mcp add --scope local causality \
  --env CAUSALITY_API_URL=http://127.0.0.1:3000 \
  --env CAUSALITY_MCP_TOKEN=<TOKEN> \
  -- pnpm --dir <PROJECT_PATH> mcp:stdio
```

### Claude Desktop

Desktop 的 `claude_desktop_config.json` 原生只支持 stdio，远程 Streamable HTTP 需通过 `mcp-remote` 桥接注入 Bearer 头：

```json
{
  "mcpServers": {
    "causality": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "<MCP_URL>", "--header", "Authorization: Bearer <TOKEN>"]
    }
  }
}
```

配置文件位置：macOS `~/Library/Application Support/Claude/claude_desktop_config.json`；Windows `%APPDATA%\Claude\claude_desktop_config.json`。修改后重启 Desktop，在“设置 → Connectors”确认 causality 已连接。

## 通用 Streamable HTTP JSON

客户端配置只需保持三项语义：`streamable-http`、`<MCP_URL>`、`Authorization: Bearer <TOKEN>`。不同客户端可以使用不同的外层字段名。首次请求必须执行 MCP initialize，后续请求携带服务端返回的会话 ID。

## 通用 stdio 命令与环境

先启动本地 API，再将客户端命令配置为：

```text
command: pnpm
args: ["--dir", "<PROJECT_PATH>", "mcp:stdio"]
env: {
  "CAUSALITY_API_URL": "http://127.0.0.1:3000",
  "CAUSALITY_MCP_TOKEN": "<个人令牌>"
}
```

stdio 还必须通过环境变量提供 `CAUSALITY_MCP_TOKEN=<个人令牌>`。协议使用 stdout；
诊断日志只写 stderr。

## MCP Inspector

```bash
cd <PROJECT_PATH>
pnpm mcp:inspect
```

Inspector 适合手工查看目录、Schema、Prompt、Resource 和 Tool 返回值，不替代自动兼容性门禁。

## Token 显示、保存、撤销与旧会话

个人令牌在参数配置页面默认缩写显示，可按需查看或复制。不要写入已跟踪文件、命令行
参数、聊天内容或日志。可以为不同客户端创建不同令牌；撤销某个令牌后，使用它的下一
个 HTTP 请求会失败，并应使用其他有效令牌重新初始化会话。

## `pnpm mcp:check`

Token 从环境或本地配置读取，禁止用 `--token`：

```bash
CAUSALITY_MCP_CHECK_TOKEN=<TOKEN> pnpm mcp:check
CAUSALITY_MCP_CHECK_TOKEN=<TOKEN> pnpm mcp:check -- --json
pnpm mcp:check -- --transport=stdio
```

文本模式适合人工排查；JSON 模式输出稳定报告。检查包括端点、认证、initialize、15/5/4 目录、Prompt、Resource、只读搜索、结构化错误和会话关闭，不写入业务数据。

## 结构化 Tool 错误

业务错误返回 `isError: true`，并在 `structuredContent.error` 提供：

- `code`：稳定错误代码；
- `category`：`validation | not_found | conflict | stale_state | unavailable | internal`；
- `message`：可读说明；
- `retryable`：当前请求是否适合直接重试；
- `suggestedAction`：下一步建议；
- `details`：只含 trace ID、HTTP 状态和数量摘要等安全字段。

采集 Tool 同时保留旧版顶层工作流错误字段。协议、认证、无效会话和未知能力仍由 HTTP/MCP 协议层返回。

## 故障排查

| 情况 | 检查与处理 |
| --- | --- |
| 服务未启动 | `docker compose ps`，再执行 `docker compose up -d --build --wait` |
| 端口错误 | 核对 `CAUSALITY_MCP_PORT` 与客户端 `<MCP_URL>` |
| Token 缺失或已撤销 | 查看现有令牌或创建新令牌，重新复制配置并新建会话 |
| initialize 失败 | 检查传输类型、URL、Origin、SDK 协议和 MCP 日志 |
| 目录数量不一致 | 重建当前镜像，运行 `pnpm test:mcp-compat` 和 `mcp:check` |
| 客户端只支持 Tool | 直接按 Tool 序列工作；Prompt/Resource 不是必需条件 |
| Prompt 或 Resource 被隐藏 | 使用固定名称直接读取，或改用同源 Skill/Markdown Prompt |
| Skill 缺失 | 确认从 `<PROJECT_PATH>` 启动，重启 Codex 或新建会话 |
| 语义增强不可用 | 使用普通搜索；在参数配置检查模型、Worker 和索引状态 |
| 方案过期、被替换或失效 | 重新对比候选并生成新的完整方案 |
| 数据可修复错误 | 按质量报告修正完整候选集合，再重新对比或生成方案 |
| 系统错误 | 不自动改数据；检查 request ID、服务日志、API、数据库后重试 |

## 手工兼容性检查清单

1. initialize 成功，`/mcp` 或目录接口显示 15 个 Tool。
2. Prompt 与 Resource 各显示 5、4 个，或确认客户端虽隐藏它们但 Tool 可用。
3. 读取 `causality_analyze_event` 和 `causality://capabilities`。
4. 普通事件搜索成功，零 UUID 返回嵌套结构化错误。
5. 两个会话可并发查询，关闭一个不影响另一个。
6. 撤销一个 Token 后旧配置失败，其他有效 Token 仍可重新连接。
7. 日志含 request ID、操作名和耗时，不含 Token、查询正文或完整响应。
8. `mcp:check` 文本与 JSON 模式均可理解，stdio 也能完成检查。
