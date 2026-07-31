# P3-03 MCP Compatibility and Usability Implementation Plan

**Status:** Implementation complete; waiting for manual review. Tasks 1–7 and all automated release gates are complete. Do not mark P3-03 complete until the user approves the manual checklist.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing 15 Tool, 5 Prompt, and 4 Resource Causality MCP surface protocol-consistent, backward-compatible, diagnosable, benchmarked, and usable from Codex or any standards-compliant Tool-capable client.

**Architecture:** Extend the existing capability manifest into the single expected catalog, route every Tool business failure through one backward-compatible error adapter, and observe both HTTP and stdio at the protocol boundary without recording payloads. Validate the real wire behavior with a read-only diagnostic client, a dedicated compatibility suite, production smoke coverage, and an isolated representative-scale benchmark.

**Tech Stack:** Node.js 24.18.0, TypeScript 6.0.2, `@modelcontextprotocol/sdk` 1.30.0, Zod 4.4.3, Vitest 4.1.10, Playwright 1.61.1, Docker Compose, PostgreSQL 18.4.

## Global Constraints

- The approved design is `docs/superpowers/specs/2026-07-31-p3-03-mcp-compatibility-usability-design.md`.
- Streamable HTTP remains the default transport; stdio remains the compatibility and debugging transport.
- Keep exactly 15 public Tools, 5 public Prompts, and 4 public Resources. Do not rename or remove them.
- Tool is the minimum portable capability. Prompt, Resource, Skill, and slash-command support must remain optional.
- Preserve every existing required input field, default, success payload, and Tool name.
- New input fields must be optional; new output fields must be backward-compatible additions.
- Do not add a Web page, database business table, online AI provider, network crawler, proxy service, or client-specific server branch.
- Do not restore the cancelled cross-model capture-quality suite.
- Never log Bearer Tokens, Authorization headers, complete requests, complete responses, conversations, complete event/case/relation text, SQL, or database credentials.
- `mcp:check` and `mcp:benchmark` must never mutate the user's normal database. Diagnostic calls are read-only; the benchmark uses a disposable Testcontainers PostgreSQL instance and always stops it.
- Do not pass a Token through a command-line argument. Read it from an environment variable or an explicitly selected local config file.
- Do not push GitHub during Tasks 1–7. Local task commits are allowed; push only after the whole stage passes review and the user explicitly requests it.
- Preserve the unrelated untracked `research/` directory and never stage it.

---

## File and Responsibility Map

### Existing files to extend

| File | Responsibility after P3-03 |
| --- | --- |
| `apps/mcp/src/capabilities/capabilityManifest.ts` | Stable names, counts, access classification, titles, complete Tool descriptions, and expected Prompt/Resource catalog |
| `apps/mcp/src/server/createMcpServer.ts` | One registration factory shared by HTTP, stdio, tests, and diagnostics |
| `apps/mcp/src/tools/registerKnowledgeTools.ts` | Knowledge Tool schemas, readable success text, shared metadata, and shared error execution wrapper |
| `apps/mcp/src/tools/registerEvidenceTools.ts` | Evidence Tool schemas, readable success text, shared metadata, and shared error execution wrapper |
| `apps/mcp/src/tools/registerCaptureTools.ts` | Controlled capture handlers using the same shared error execution wrapper while preserving legacy workflow error fields |
| `apps/mcp/src/transports/httpServer.ts` | HTTP authentication, sessions, request-scoped API credentials, protocol observation, and safe session cleanup |
| `apps/mcp/src/transports/stdioServer.ts` | stdio connection, current Token acquisition, and the same protocol observation wrapper |
| `apps/mcp/src/config/env.ts` | MCP runtime environment only; it must not absorb diagnostic-only settings |
| `apps/mcp/package.json` | `check`, `test:compat`, and `benchmark` workspace commands |
| `package.json` | Root `mcp:check`, `test:mcp-compat`, and `mcp:benchmark` commands |
| `tests/production/production-smoke.spec.ts` | Real production HTTP authentication, initialize, catalog, Resource, Prompt, and read-only Tool smoke |
| `README.md` | Short default MCP setup and links to focused guides |
| `docs/superpowers/plans/2026-07-20-causality-application-roadmap.md` | P3-03 implementation and acceptance state |
| `docs/superpowers/specs/2026-07-31-p3-03-mcp-compatibility-usability-design.md` | Approved scope and final acceptance evidence |

### New focused files

| File | Single responsibility |
| --- | --- |
| `apps/mcp/src/tools/toolError.ts` | Convert API, configuration, contract, and unexpected failures into the stable MCP Tool error shape |
| `apps/mcp/src/tools/executeTool.ts` | Run one Tool action, preserve success output, and convert/log failures once |
| `apps/mcp/src/observability/mcpRequestLogging.ts` | Describe a JSON-RPC operation and emit payload-free start/completion logs |
| `apps/mcp/src/transports/observedTransport.ts` | Decorate a stdio-compatible SDK `Transport` and observe incoming JSON-RPC messages |
| `apps/mcp/src/config/checkConfig.ts` | Parse diagnostic environment, optional config file, transport, and output mode |
| `apps/mcp/src/diagnostics/mcpCheckTypes.ts` | Stable text/JSON diagnostic report types and schemas |
| `apps/mcp/src/diagnostics/mcpCheck.ts` | Connect a real MCP client and execute the read-only diagnostic sequence |
| `apps/mcp/src/check.ts` | CLI entrypoint, rendering, exit code, and cleanup |
| `apps/mcp/src/benchmark/mcpBenchmarkMetrics.ts` | Measure duration, response bytes, result counts, truncation, and sampled RSS peak |
| `apps/mcp/src/benchmark/mcpBenchmarkClient.ts` | Run the reviewed MCP benchmark scenarios against the isolated stack |
| `scripts/run-mcp-benchmark.sh` | Start the benchmark API/MCP processes, propagate Docker context safely, and always clean up subprocesses and temporary files |
| `apps/mcp/test/support/connectTestMcpClient.ts` | Reusable in-memory MCP client/server pair for catalog and Tool tests |
| `apps/mcp/test/toolError.test.ts` | Error mapping and backward-compatibility unit tests |
| `apps/mcp/test/mcpRequestLogging.test.ts` | Logging field, redaction, duration, and outcome tests |
| `apps/mcp/test/mcpCheck.test.ts` | Diagnostic sequencing, report, failure, config, and cleanup tests |
| `apps/mcp/test/mcpBenchmarkMetrics.test.ts` | Benchmark measurement and correctness assertion tests |
| `apps/mcp/test/compatibility/httpCompatibility.test.ts` | Real HTTP initialize, authorization, catalog, error, and concurrent-session contract |
| `apps/mcp/test/compatibility/stdioCompatibility.test.ts` | Real stdio-process catalog, Prompt, Resource, Tool, and error contract |
| `docs/mcp-client-compatibility.md` | Codex, generic HTTP, generic stdio, Inspector, diagnostics, errors, and troubleshooting |
| `docs/mcp-workflows.md` | Five ordinary-language, Prompt, Skill, Tool-sequence, confirmation, and recovery recipes |

---

### Task 1: Make the Existing Capability Manifest the Registration Source

**Files:**
- Modify: `apps/mcp/src/capabilities/capabilityManifest.ts`
- Modify: `apps/mcp/src/tools/registerKnowledgeTools.ts`
- Modify: `apps/mcp/src/tools/registerEvidenceTools.ts`
- Modify: `apps/mcp/src/tools/registerCaptureTools.ts`
- Create: `apps/mcp/test/support/connectTestMcpClient.ts`
- Create: `apps/mcp/test/capabilityRegistration.test.ts`
- Modify: `apps/mcp/test/capabilityManifest.test.ts`

**Interfaces:**
- Produces: `McpToolName`, `McpToolCapability`, `MCP_CAPABILITY_COUNTS`, and `toolRegistrationMetadata(name)`.
- Produces: `connectTestMcpClient(api)` returning `{ client, server, close }` for later Tool-error tests.
- Preserves: `MCP_TOOL_NAMES`, `MCP_PROMPT_NAMES`, `MCP_RESOURCE_URIS`, and `MCP_CAPABILITY_MANIFEST`.

- [ ] **Step 1: Add failing manifest metadata and registration tests**

Extend `capabilityManifest.test.ts` so every Tool has a non-empty title and a description containing all four required concepts: access mode, prerequisite, limit, and next action. Add `capabilityRegistration.test.ts` that connects an SDK `Client` through `InMemoryTransport`, lists the three capability types, and compares exact stable sets:

```ts
expect(listedTools.map(({ name }) => name)).toEqual(Object.values(MCP_TOOL_NAMES));
expect(listedPrompts.map(({ name }) => name)).toEqual(Object.values(MCP_PROMPT_NAMES));
expect(listedResources.map(({ uri }) => uri)).toEqual(Object.values(MCP_RESOURCE_URIS));
expect(listedTools).toHaveLength(MCP_CAPABILITY_COUNTS.tools);
expect(listedPrompts).toHaveLength(MCP_CAPABILITY_COUNTS.prompts);
expect(listedResources).toHaveLength(MCP_CAPABILITY_COUNTS.resources);
```

Create the test helper with this exact interface:

```ts
export interface ConnectedTestMcpClient {
  client: Client;
  server: McpServer;
  close(): Promise<void>;
}

export async function connectTestMcpClient(
  api: CausalityMcpApi,
): Promise<ConnectedTestMcpClient>;
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```bash
pnpm --filter @causality/mcp exec vitest run \
  test/capabilityManifest.test.ts \
  test/capabilityRegistration.test.ts
```

Expected: FAIL because `MCP_CAPABILITY_COUNTS`, complete metadata, and the test helper do not exist.

- [ ] **Step 3: Expand the existing manifest without creating a second catalog**

Export these types and helpers from `capabilityManifest.ts`:

```ts
export type McpToolName = (typeof MCP_TOOL_NAMES)[keyof typeof MCP_TOOL_NAMES];
export type CapabilityAccess = 'read_only' | 'controlled_write';

export interface McpToolCapability {
  name: McpToolName;
  title: string;
  description: string;
  purpose: string;
  access: CapabilityAccess;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: false;
  };
}

export const MCP_CAPABILITY_COUNTS = {
  tools: 15,
  prompts: 5,
  resources: 4,
} as const;

export function toolRegistrationMetadata(name: McpToolName) {
  const capability = MCP_CAPABILITY_MANIFEST.tools.find((tool) => tool.name === name);
  if (!capability) throw new Error(`Unknown MCP Tool capability: ${name}`);
  return {
    title: capability.title,
    description: capability.description,
    annotations: capability.annotations,
  } as const;
}
```

Keep the existing annotations exactly: every read-only Tool is read-only, non-destructive, and idempotent; `prepare_knowledge_changes` is non-read-only, non-destructive, and non-idempotent; `commit_knowledge_changes` is non-read-only, destructive, and idempotent.

Use the following exact description requirements when filling the 15 manifest entries:

| Tool | Exact `description` text |
| --- | --- |
| `search_atomic_events` | `只读工具。按名称、别名或关键词执行普通搜索，仅在明确要求时使用语义增强；查询最长 80 字、页码最多 100000。取得候选 ID 后使用事件详情或路径工具核对。` |
| `get_atomic_event` | `只读工具。使用有效原子事件 UUID 读取详情和一页关联关系；每页最多 100 条并通过游标续页。需要完整证据时继续读取关系详情和案例。` |
| `search_concrete_cases` | `只读工具。按最长 100 字的案例内容关键词分页搜索，页码最多 100000。取得案例 ID 后使用案例详情工具核对关联关系。` |
| `get_causal_relation` | `只读工具。使用有效因果关系 UUID 读取方向、置信度、案例数和说明。需要案例证据时继续调用关系案例工具。` |
| `get_relation_cases` | `只读工具。使用有效因果关系 UUID 分页读取关联案例；每页最多 100 条并通过游标续页。只在确有需要时续取至 hasMore=false。` |
| `query_local_causal_graph` | `只读工具。使用有效中心事件和上游、下游或双向方向查询局部图；原子事件上限只能为 20、50 或 100。下结论前必须检查停止原因和截断状态。` |
| `get_concrete_case` | `只读工具。使用有效具体案例 UUID 读取详情和一页关联关系；每页最多 100 条并通过游标续页。需要因果信息时继续读取关系详情。` |
| `search_causal_relations` | `只读工具。按原因事件、结果事件或关系说明执行普通或明确请求的语义增强搜索，页码最多 100000。取得关系 ID 后使用详情或证据工具核对。` |
| `find_causal_paths` | `只读工具。使用两个原子事件 UUID 沿真实方向查询简单路径；深度最多 10、路径最多 10，并受扩展状态上限约束。选定路径后使用证据包核对。` |
| `get_causal_evidence_bundle` | `只读工具。按顺序提交 1 至 10 个关系 UUID，读取逐段关系和限量案例。输出时必须说明无案例关系和案例截断。` |
| `compare_knowledge_candidates` | `只读工具。一次对比完整关联的事件、案例、关系和案例关联候选，原子事件最多 50 条。处理质量问题后再生成入库方案。` |
| `prepare_knowledge_changes` | `受控写入工具。根据完整候选、对比和决策只生成限时不可变方案，不写入正式知识。提交前先展示并核对最新方案。` |
| `get_import_plan_status` | `只读工具。使用有效方案 UUID 检查方案是否待提交、已失效或已进入终态。根据当前状态决定提交、重新对比或重新生成方案。` |
| `commit_knowledge_changes` | `受控事务写入工具。只能在用户明确确认最新完整方案后按方案 UUID 提交；同一方案保持幂等。响应不明确时使用结果查询工具恢复。` |
| `get_import_result` | `只读工具。使用成功 AI 导入历史 UUID 读取已完成的幂等结果和采集标记。用于提交响应不明确后的恢复或成功结果追溯。` |

- [ ] **Step 4: Replace the three local metadata/annotation definitions**

In each Tool registration module, replace hard-coded `title`, `description`, and local annotation objects with:

```ts
const metadata = toolRegistrationMetadata(MCP_TOOL_NAMES.searchAtomicEvents);
server.registerTool(
  MCP_TOOL_NAMES.searchAtomicEvents,
  {
    ...metadata,
    inputSchema: searchEventsInputSchema,
    outputSchema: eventListResponseSchema,
  },
  handler,
);
```

Do this for all 15 Tools. Keep every input/output Schema and handler result unchanged.

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
pnpm --filter @causality/mcp exec vitest run \
  test/capabilityManifest.test.ts \
  test/capabilityRegistration.test.ts \
  test/knowledgeTools.test.ts \
  test/evidenceTools.test.ts \
  test/captureTools.test.ts
pnpm --filter @causality/mcp typecheck
```

Expected: all pass; listed public sets remain exactly 15/5/4 and success payload tests remain unchanged.

- [ ] **Step 6: Commit Task 1**

```bash
git add \
  apps/mcp/src/capabilities/capabilityManifest.ts \
  apps/mcp/src/tools/registerKnowledgeTools.ts \
  apps/mcp/src/tools/registerEvidenceTools.ts \
  apps/mcp/src/tools/registerCaptureTools.ts \
  apps/mcp/test/support/connectTestMcpClient.ts \
  apps/mcp/test/capabilityManifest.test.ts \
  apps/mcp/test/capabilityRegistration.test.ts
git commit -m "refactor: centralize MCP capability metadata"
```

---

### Task 2: Standardize Backward-Compatible Tool Business Errors

**Files:**
- Create: `apps/mcp/src/tools/toolError.ts`
- Create: `apps/mcp/src/tools/executeTool.ts`
- Modify: `apps/mcp/src/tools/registerKnowledgeTools.ts`
- Modify: `apps/mcp/src/tools/registerEvidenceTools.ts`
- Modify: `apps/mcp/src/tools/registerCaptureTools.ts`
- Create: `apps/mcp/test/toolError.test.ts`
- Modify: `apps/mcp/test/knowledgeTools.test.ts`
- Modify: `apps/mcp/test/evidenceTools.test.ts`
- Modify: `apps/mcp/test/captureTools.test.ts`

**Interfaces:**
- Produces: `McpToolErrorCategory`, `McpToolError`, `McpToolErrorStructuredContent`, `normalizeToolError(error)`, and `toolErrorResult(error)`.
- Produces: `executeTool(toolName, logger, action)` used by every Tool callback.
- Preserves: capture error top-level `AiWorkflowError` fields while adding nested `error`.

- [ ] **Step 1: Write failing error-mapping tests**

Define the expected public shape in `toolError.test.ts`:

```ts
expect(toolErrorResult(apiNotFound)).toMatchObject({
  isError: true,
  structuredContent: {
    error: {
      code: 'EVENT_NOT_FOUND',
      category: 'not_found',
      message: expect.any(String),
      retryable: false,
      suggestedAction: expect.any(String),
      details: { traceId: 'trace-1' },
    },
  },
});
```

Add one mapping test for each category:

- `validation`: HTTP 400 or a validation code;
- `not_found`: HTTP 404;
- `conflict`: HTTP 409 or a duplicate/terminal-state code;
- `stale_state`: `AI_PLAN_COMPARISON_STALE`, expired, replaced, or invalidated plan code;
- `unavailable`: API timeout, connection failure, missing stdio Token, HTTP 502/503/504;
- `internal`: invalid API response and unexpected exception.

Assert no serialized error contains a cause, stack, URL credentials, Token, SQL, or full payload.

Add regression assertions to `captureTools.test.ts` proving legacy fields remain:

```ts
expect(result.structuredContent).toMatchObject({
  category: 'data',
  code: 'AI_PLAN_COMPARISON_STALE',
  suggestedAction: expect.any(String),
  error: {
    category: 'stale_state',
    retryable: false,
  },
});
```

Add one rejected API call to `knowledgeTools.test.ts` and one to `evidenceTools.test.ts`; both must return `isError: true` instead of rejecting through the SDK.

- [ ] **Step 2: Run tests and confirm RED**

```bash
pnpm --filter @causality/mcp exec vitest run \
  test/toolError.test.ts \
  test/knowledgeTools.test.ts \
  test/evidenceTools.test.ts \
  test/captureTools.test.ts
```

Expected: FAIL because read-only Tools currently throw, capture errors do not expose nested `error`, and shared mapping does not exist.

- [ ] **Step 3: Implement the stable error types and mapping**

Use these exact types in `toolError.ts`:

```ts
export type McpToolErrorCategory =
  | 'validation'
  | 'not_found'
  | 'conflict'
  | 'stale_state'
  | 'unavailable'
  | 'internal';

export interface McpToolError {
  code: string;
  category: McpToolErrorCategory;
  message: string;
  retryable: boolean;
  suggestedAction: string;
  details: Record<string, string | number | boolean | null>;
}

export interface McpToolErrorStructuredContent extends Record<string, unknown> {
  error: McpToolError;
}
```

Map API failures by stable code first, then HTTP status, then `CausalityApiClientError.kind`. Use these precedence rules:

```ts
const staleCodes = new Set([
  'AI_PLAN_COMPARISON_STALE',
  'AI_PLAN_EXPIRED',
  'AI_PLAN_NOT_LATEST',
  'AI_PLAN_DEPENDENCY_CHANGED',
]);

const category = staleCodes.has(error.code)
  ? 'stale_state'
  : error.status === 404
    ? 'not_found'
    : error.status === 409
      ? 'conflict'
      : error.status === 400 || error.status === 422
        ? 'validation'
        : error.kind === 'configuration' || [502, 503, 504].includes(error.status ?? 0)
          ? 'unavailable'
          : error.kind === 'system' && ['API_UNAVAILABLE', 'API_REQUEST_ABORTED'].includes(error.code)
            ? 'unavailable'
            : 'internal';
```

Set `retryable=true` only for temporary `unavailable` codes. Configuration errors such as `MCP_TOKEN_MISSING` use `unavailable` but `retryable=false` until configuration changes.

Only copy safe details: `traceId`, `status`, `affectedRefCount`, `qualityIssueCount`, and plan state when already present. Never copy `cause` or raw payloads.

For capture errors, spread the existing `AiWorkflowError` fields at the top level and add `error`. For other Tools, return only `{ error }` as structured content. The text content must contain message, code, retryability, and suggested action.

- [ ] **Step 4: Implement the shared execution wrapper**

Use this interface in `executeTool.ts`:

```ts
export interface ToolExecutionLogger {
  error(entry: Record<string, unknown>): void;
}

export async function executeTool(
  toolName: McpToolName,
  logger: ToolExecutionLogger,
  action: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  try {
    return await action();
  } catch (error) {
    const normalized = normalizeToolError(error);
    logger.error({
      event: 'mcp_tool_failed',
      tool: toolName,
      errorCode: normalized.code,
      category: normalized.category,
      retryable: normalized.retryable,
      traceId: normalized.details.traceId ?? null,
    });
    return toolErrorResult(error);
  }
}
```

Remove `workflowError`, `errorResult`, and `logToolFailure` from `registerCaptureTools.ts` after their behavior is covered centrally.

- [ ] **Step 5: Wrap all 15 handlers**

Each handler must follow this pattern without changing its success result:

```ts
async ({ query, page, searchMode }) =>
  executeTool(MCP_TOOL_NAMES.searchAtomicEvents, logger, async () => {
    const result = await apiClient.searchEvents(query, page, searchMode);
    return textResult(eventSearchText(result), { ...result });
  });
```

Extend `registerKnowledgeTools` and `registerEvidenceTools` to accept the same optional logger used by capture Tools. Pass one logger from `createCausalityMcpServer` to all three registration functions.

- [ ] **Step 6: Run focused and full MCP tests**

```bash
pnpm --filter @causality/mcp exec vitest run \
  test/toolError.test.ts \
  test/knowledgeTools.test.ts \
  test/evidenceTools.test.ts \
  test/captureTools.test.ts \
  test/causalityApiClient.test.ts
pnpm --filter @causality/mcp test
pnpm --filter @causality/mcp typecheck
```

Expected: all pass; all business failures return `isError=true`; existing success and capture legacy-error assertions still pass.

- [ ] **Step 7: Commit Task 2**

```bash
git add apps/mcp/src/tools apps/mcp/src/server/createMcpServer.ts apps/mcp/test
git commit -m "feat: standardize MCP Tool errors"
```

---

### Task 3: Add Payload-Free Protocol Logging and Complete Session Regression

**Files:**
- Create: `apps/mcp/src/observability/mcpRequestLogging.ts`
- Create: `apps/mcp/src/transports/observedTransport.ts`
- Modify: `apps/mcp/src/transports/httpServer.ts`
- Modify: `apps/mcp/src/transports/stdioServer.ts`
- Modify: `apps/mcp/src/server/createMcpServer.ts`
- Modify: `apps/mcp/src/tools/executeTool.ts`
- Create: `apps/mcp/test/mcpRequestLogging.test.ts`
- Modify: `apps/mcp/test/httpTransport.test.ts`
- Modify: `apps/mcp/test/stdioTransport.test.ts`

**Interfaces:**
- Produces: `McpLogger`, `McpOperationDescriptor`, `describeMcpMessage(message)`, and `observeMcpRequest(context, action)`.
- Produces: `ObservedTransport` implementing the SDK `Transport` interface for stdio observation.
- Extends HTTP `Session` with safe `clientName` and `clientVersion` only.

- [ ] **Step 1: Write failing redaction and lifecycle tests**

In `mcpRequestLogging.test.ts`, assert the descriptor extracts only stable routing fields:

```ts
expect(describeMcpMessage({
  jsonrpc: '2.0',
  id: 7,
  method: 'tools/call',
  params: { name: 'search_atomic_events', arguments: { query: 'secret event text' } },
})).toEqual({
  method: 'tools/call',
  toolName: 'search_atomic_events',
});
```

Assert serialized logs contain `requestId`, transport, operation, tool name, duration, outcome, client name/version when supplied, and never contain the query, Token, Authorization, full response, or Error cause.

In `httpTransport.test.ts`, add:

- two initialized sessions that list Tools concurrently;
- an invalid session ID returning the reviewed protocol response while both valid sessions still work;
- DELETE/close cleanup when supported by the SDK transport;
- rotated Token behavior using a newly initialized session as well as an existing session;
- start/completion log correlation by request ID.

In `stdioTransport.test.ts`, assert initialize, catalog, Prompt, Resource, and Tool operations emit payload-free entries with `transport: 'stdio'`.

- [ ] **Step 2: Run tests and confirm RED**

```bash
pnpm --filter @causality/mcp exec vitest run \
  test/mcpRequestLogging.test.ts \
  test/httpTransport.test.ts \
  test/stdioTransport.test.ts
```

Expected: FAIL because only isolated HTTP/capture failure logs exist and stdio has no protocol observer.

- [ ] **Step 3: Implement the shared request log model**

Create these public types:

```ts
export interface McpLogger {
  info(entry: Record<string, unknown> | string): void;
  error(entry: Record<string, unknown> | string): void;
}

export interface McpOperationDescriptor {
  method: string;
  toolName?: string;
  promptName?: string;
  resourceUri?: string;
}

export interface McpRequestLogContext extends McpOperationDescriptor {
  requestId: string;
  transport: 'streamable-http' | 'stdio';
  clientName?: string;
  clientVersion?: string;
}
```

`describeMcpMessage` may inspect only `method`, `params.name`, and `params.uri`. It must not retain `arguments`, request bodies, or response content.

`observeMcpRequest` emits:

```ts
{ event: 'mcp_request_started', requestId, transport, method, toolName, promptName, resourceUri, clientName, clientVersion }
{ event: 'mcp_request_completed', requestId, transport, method, outcome, durationMs, errorCode }
```

Use `performance.now()` and round `durationMs` to a non-negative integer. Unexpected exceptions use `outcome: 'system_error'`; protocol rejection uses `protocol_error`; Tool business errors are reported by `executeTool` as `business_error` with the same request ID when request context exists.

- [ ] **Step 4: Observe HTTP without logging the body**

Generate a request ID per incoming `/mcp` request. Parse initialize `clientInfo.name/version` only after confirming the message is initialize, store those two strings in the `Session`, and pass them to later log contexts.

Wrap `transport.handleRequest` with `observeMcpRequest`. Authorization failures, body-size failures, invalid JSON, and invalid sessions log protocol outcome and status without Token or body.

Keep the current request-scoped `CausalityApiClient` and per-request reauthorization unchanged.

- [ ] **Step 5: Observe stdio with a transport decorator**

Implement `ObservedTransport` as a transparent SDK `Transport` decorator. It forwards `start`, `send`, `close`, `onclose`, `onerror`, and `sessionId` behavior. Its incoming `onmessage` wrapper calls `describeMcpMessage`, stores initialize client name/version, and executes the original callback inside `observeMcpRequest`.

The decorator must never write logs to stdout because stdout is the stdio protocol channel. All default stdio logs remain on `console.error` or an injected logger.

- [ ] **Step 6: Connect Tool completion summaries and errors to request correlation**

Use `AsyncLocalStorage<McpRequestLogContext>` inside `mcpRequestLogging.ts`. `observeMcpRequest` sets it; `executeTool` reads it and adds the same request ID, transport, and safe client fields to Tool completion logs without changing Tool results.

Extend `executeTool` with optional count-only metadata:

```ts
export interface ToolExecutionSummary {
  inputCounts?: Record<string, number>;
  outputCounts?: (result: CallToolResult) => Record<string, number>;
}

export async function executeTool(
  toolName: McpToolName,
  logger: McpLogger,
  action: () => Promise<CallToolResult>,
  summary: ToolExecutionSummary = {},
): Promise<CallToolResult>;
```

On success, emit `mcp_tool_completed` with duration and only numeric counts such as page, requested limit, candidate counts, returned items, graph events/relations, paths, or cases. On failure, emit `mcp_tool_failed` with normalized code/category/retryability. Never pass query text, UUIDs, descriptions, candidate content, aliases, keywords, or the result object into a logger.

- [ ] **Step 7: Run focused and full MCP regression**

```bash
pnpm --filter @causality/mcp exec vitest run \
  test/mcpRequestLogging.test.ts \
  test/httpTransport.test.ts \
  test/stdioTransport.test.ts \
  test/toolError.test.ts
pnpm --filter @causality/mcp test
pnpm --filter @causality/mcp typecheck
```

Expected: all pass and redaction assertions find no secret body or Token.

- [ ] **Step 8: Commit Task 3**

```bash
git add \
  apps/mcp/src/observability \
  apps/mcp/src/transports \
  apps/mcp/src/server/createMcpServer.ts \
  apps/mcp/src/tools/executeTool.ts \
  apps/mcp/test/mcpRequestLogging.test.ts \
  apps/mcp/test/httpTransport.test.ts \
  apps/mcp/test/stdioTransport.test.ts
git commit -m "feat: add safe MCP request observability"
```

---

### Task 4: Build the Read-Only `mcp:check` Diagnostic

**Files:**
- Create: `apps/mcp/src/config/checkConfig.ts`
- Create: `apps/mcp/src/diagnostics/mcpCheckTypes.ts`
- Create: `apps/mcp/src/diagnostics/mcpCheck.ts`
- Create: `apps/mcp/src/check.ts`
- Create: `apps/mcp/test/mcpCheck.test.ts`
- Modify: `apps/mcp/package.json`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `McpCheckOptions`, `McpCheckItem`, `McpCheckReport`, `loadMcpCheckOptions`, `runMcpCheck`, `renderMcpCheckText`, and the root `pnpm mcp:check` command.
- Consumes: the shared manifest and standardized Tool error shape from Tasks 1–2.

- [ ] **Step 1: Write failing configuration and report tests**

Use these exact public types:

```ts
export type McpCheckTransport = 'streamable-http' | 'stdio';
export type McpCheckStatus = 'passed' | 'failed' | 'skipped';

export interface McpCheckItem {
  id: string;
  label: string;
  status: McpCheckStatus;
  durationMs: number;
  message: string;
  suggestedAction: string | null;
}

export interface McpCheckReport {
  schemaVersion: 1;
  transport: McpCheckTransport;
  endpoint: string | null;
  startedAt: string;
  completedAt: string;
  success: boolean;
  counts: { tools: number; prompts: number; resources: number };
  items: McpCheckItem[];
}
```

Add tests for:

- default HTTP endpoint `http://127.0.0.1:8081/mcp`;
- `CAUSALITY_MCP_CHECK_URL` and `CAUSALITY_MCP_CHECK_TOKEN`;
- optional `CAUSALITY_MCP_CHECK_CONFIG` JSON `{ "url": "...", "token": "..." }`;
- `--transport=stdio` and `--json`;
- rejection of `--token`, unknown flags, invalid URL, malformed Token, and unreadable config;
- text output never containing the Token;
- cleanup after success, connection failure, catalog mismatch, and interruption.

- [ ] **Step 2: Run the focused test and confirm RED**

```bash
pnpm --filter @causality/mcp exec vitest run test/mcpCheck.test.ts
```

Expected: FAIL because the diagnostic modules and commands do not exist.

- [ ] **Step 3: Implement diagnostic configuration**

`loadMcpCheckOptions(args, env, readFile)` accepts only:

```text
--transport=streamable-http|stdio
--json
--config=<path>
--help
```

For HTTP, resolve URL and Token from explicit environment first, then the selected config file, then the default URL. A missing Token produces a failed configuration report without attempting an authorized request. Add `.causality-mcp-check.json` to `.gitignore`; never create it automatically.

For stdio, accept `CAUSALITY_API_URL` and launch the existing stdio entry; it loads the current Token through `/api/mcp/settings` as it does today.

- [ ] **Step 4: Implement the real-client diagnostic sequence**

`runMcpCheck(options, dependencies)` must execute these item IDs in order:

```ts
const requiredItems = [
  'endpoint_reachable',
  'unauthorized_rejected',
  'initialize',
  'tools_catalog',
  'prompts_catalog',
  'resources_catalog',
  'prompt_read',
  'resource_read',
  'readonly_search',
  'structured_error',
  'session_close',
] as const;
```

HTTP uses `StreamableHTTPClientTransport`; stdio uses `StdioClientTransport`. In stdio mode, `unauthorized_rejected` is `skipped` with message “stdio 不使用 HTTP Bearer 认证”.

Use these read-only probes:

- Prompt: `causality_analyze_event`;
- Resource: `causality://capabilities`;
- success Tool: `search_atomic_events` with query `__causality_mcp_check_no_match__`, page 1, standard search;
- business-error Tool: `get_atomic_event` with UUID `00000000-0000-4000-8000-000000000000`, which must return `isError=true` and nested `error`.

Compare catalog names and counts against the shared manifest. Always close `Client`, transport, and spawned stdio process in `finally`.

- [ ] **Step 5: Implement CLI rendering and scripts**

Add workspace scripts:

```json
{
  "check": "tsx src/check.ts",
  "test:compat": "vitest run test/compatibility"
}
```

Add root scripts:

```json
{
  "mcp:check": "pnpm --filter @causality/contracts build && pnpm --filter @causality/mcp check",
  "test:mcp-compat": "pnpm --filter @causality/mcp test:compat"
}
```

Text rendering prints one line per item, the catalog counts, and a final result. JSON rendering writes only the report JSON to stdout. Human diagnostics go to stderr only when JSON mode is active.

- [ ] **Step 6: Run unit tests and manual local smoke**

```bash
pnpm --filter @causality/mcp exec vitest run test/mcpCheck.test.ts
pnpm --filter @causality/mcp typecheck
pnpm mcp:check -- --help
```

Start the current local stack, set `CAUSALITY_MCP_CHECK_TOKEN` without echoing it, then run:

```bash
pnpm mcp:check
pnpm mcp:check -- --json
pnpm mcp:check -- --transport=stdio
```

Expected: HTTP and stdio report 15 Tools, 5 Prompts, 4 Resources; the missing event is classified as an expected structured error; no knowledge rows or import plans are created.

- [ ] **Step 7: Commit Task 4**

```bash
git add \
  .gitignore \
  package.json \
  apps/mcp/package.json \
  apps/mcp/src/config/checkConfig.ts \
  apps/mcp/src/diagnostics \
  apps/mcp/src/check.ts \
  apps/mcp/test/mcpCheck.test.ts
git commit -m "feat: add MCP compatibility diagnostic"
```

---

### Task 5: Add the Dedicated Wire-Compatibility and Production Suite

**Files:**
- Create: `apps/mcp/test/compatibility/httpCompatibility.test.ts`
- Create: `apps/mcp/test/compatibility/stdioCompatibility.test.ts`
- Modify: `apps/mcp/package.json`
- Modify: `package.json`
- Modify: `tests/production/production-smoke.spec.ts`
- Modify: `tests/production/compose-contract.test.mjs`
- Modify: `tests/production/e2e-contract.test.mjs`
- Modify: `scripts/test-production-compose.sh`

**Interfaces:**
- Produces: `pnpm test:mcp-compat` as the stable focused compatibility gate.
- Consumes: real diagnostic client, catalog, errors, session behavior, and logs from Tasks 1–4.

- [ ] **Step 1: Write failing HTTP wire-compatibility tests**

Start `startCausalityMcpHttpServer` on an ephemeral port with the existing fake API authorization server. Connect with `StreamableHTTPClientTransport` and assert:

- initialize succeeds with the SDK-negotiated protocol;
- exact 15/5/4 catalogs;
- one Prompt and Resource read;
- one read-only success Tool;
- one read-only not-found Tool returns the reviewed nested error;
- absent and invalid Tokens receive HTTP 401;
- unknown session receives the reviewed protocol error;
- two sessions query concurrently and close independently;
- Token rotation rejects old authorization and accepts a newly initialized session;
- logs contain safe routing fields and no Token or probe text.

- [ ] **Step 2: Write failing real-process stdio compatibility tests**

Create a minimal local HTTP fake for `/api/mcp/settings`, health/readiness/lifecycle, event search, and event detail not-found. Spawn the built stdio entry with SDK `StdioClientTransport`:

```ts
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['apps/mcp/dist/stdio.js'],
  env: { ...safeEnv, CAUSALITY_API_URL: fakeApiUrl },
  stderr: 'pipe',
});
```

Assert the same catalog, Prompt, Resource, success Tool, and structured error as HTTP. Capture stderr and assert it contains safe operation logs but no Token or business probe text.

- [ ] **Step 3: Run compatibility tests and confirm RED**

```bash
pnpm --filter @causality/contracts build
pnpm --filter @causality/mcp build
pnpm test:mcp-compat
```

Expected: FAIL until the compatibility test script, real stdio path, and production checks are wired.

- [ ] **Step 4: Complete the stable compatibility command**

Set the MCP workspace script to build before spawning stdio when invoked from the root:

```json
{
  "test:compat": "vitest run test/compatibility"
}
```

Root:

```json
{
  "test:mcp-compat": "pnpm --filter @causality/contracts build && pnpm --filter @causality/mcp build && pnpm --filter @causality/mcp test:compat"
}
```

Do not add retries that hide deterministic failures. Use bounded per-test timeouts and always close clients, servers, transports, subprocesses, and fake API listeners.

- [ ] **Step 5: Extend production smoke through the real MCP port**

In `production-smoke.spec.ts`:

1. fetch `/api/mcp/settings` through the Web reverse proxy;
2. keep the Token only in a local variable;
3. connect an SDK `Client` to `http://127.0.0.1:${mcpPort}/mcp`;
4. assert exact catalogs;
5. read `causality://capabilities` and `causality_infer_outcomes`;
6. call standard event search against the empty database;
7. close the Client before restarting Compose;
8. reconnect after restart and repeat the catalog assertion.

Do not print the settings response or Token. Keep the existing unauthenticated 401 assertion.

Update Compose/root-script contract tests to require the new compatibility command and MCP smoke steps.

- [ ] **Step 6: Run focused compatibility and production contract tests**

```bash
pnpm test:mcp-compat
pnpm test:compose
pnpm --filter @causality/mcp test
pnpm --filter @causality/mcp typecheck
```

Expected: all pass.

- [ ] **Step 7: Run the production smoke test**

```bash
pnpm test:production
```

Expected: one production smoke passes, including empty start, MCP authentication/catalog/read-only call, persistence, explicit seed, restart, and cleanup.

- [ ] **Step 8: Commit Task 5**

```bash
git add \
  package.json \
  apps/mcp/package.json \
  apps/mcp/test/compatibility \
  tests/production \
  scripts/test-production-compose.sh
git commit -m "test: add MCP wire compatibility gates"
```

---

### Task 6: Establish the Representative MCP Capacity Baseline

**Files:**
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/features/ai-capture/aiCaptureRoutes.ts`
- Create: `apps/api/src/database/benchmark/mcpBenchmarkApi.ts`
- Create: `apps/api/test/mcp-benchmark-api.test.ts`
- Modify: `apps/api/package.json`
- Create: `apps/mcp/src/benchmark/mcpBenchmarkMetrics.ts`
- Create: `apps/mcp/src/benchmark/mcpBenchmarkClient.ts`
- Create: `apps/mcp/test/mcpBenchmarkMetrics.test.ts`
- Create: `scripts/run-mcp-benchmark.sh`
- Modify: `apps/mcp/package.json`
- Modify: `package.json`
- Modify: `tests/production/e2e-contract.test.mjs`
- Create: `docs/mcp-capacity-baseline.md`

**Interfaces:**
- Produces: optional `aiCaptureSemanticCandidates` dependency injection on `buildApp`; production defaults remain unchanged.
- Produces: benchmark-only API entrypoint using the real database plus a deterministic semantic adapter, so candidate comparison and plan generation can be measured without downloading a model or building vectors.
- Produces: `McpBenchmarkScenarioMetric`, `McpBenchmarkSummary`, `measureMcpScenario`, and `assertMcpBenchmarkCorrectness`.
- Produces: `pnpm mcp:benchmark`, which writes the full transient result to `test-results/mcp-benchmark-summary.json` and a concise reviewed baseline to `docs/mcp-capacity-baseline.md`.

- [ ] **Step 1: Write failing benchmark metric tests**

Use these exact types:

```ts
export interface McpBenchmarkScenarioMetric {
  name: string;
  coldMilliseconds: number;
  repeatedMilliseconds: number;
  responseBytes: number;
  resultCount: number;
  truncated: boolean;
  peakRssDeltaBytes: number;
  failures: number;
}

export interface McpBenchmarkSummary {
  schemaVersion: 1;
  generatedAt: string;
  dataset: { events: 10_000; relations: 30_000; cases: 100_000; seed: 20260731 };
  catalog: { tools: 15; prompts: 5; resources: 4 };
  scenarios: McpBenchmarkScenarioMetric[];
}
```

Test that `measureMcpScenario` samples RSS while the Promise is active, stops the sampler in `finally`, records JSON byte size, and reports a failure without hiding the original error.

Test `assertMcpBenchmarkCorrectness` rejects:

- a failed scenario;
- duplicate or missing pagination IDs;
- response count above the Tool limit;
- missing truncation at a reached limit;
- negative duration or RSS values;
- incorrect 15/5/4 catalog;
- dataset counts other than 10,000/30,000/100,000.

- [ ] **Step 2: Run the metric test and confirm RED**

```bash
pnpm --filter @causality/mcp exec vitest run test/mcpBenchmarkMetrics.test.ts
```

Expected: FAIL because the benchmark metric module does not exist.

- [ ] **Step 3: Implement metrics and correctness checks**

Sample `process.memoryUsage().rss` every 20 ms during each measured action. Always clear the interval. Measure cold and immediate repeated calls separately. Compute response bytes with `Buffer.byteLength(JSON.stringify(result), 'utf8')`.

Correctness checks are release blockers; elapsed-time values are recorded only. Do not add a hard latency threshold in P3-03.

- [ ] **Step 4: Add benchmark-only semantic dependency injection**

The production AI-capture route currently constructs `AiSemanticCandidateService` internally and requires a downloaded model plus a complete vector index for every non-empty candidate set. P3-03 explicitly excludes model download and index generation from the MCP capacity run, so add a narrow optional dependency without changing production defaults.

Export this structural interface from `aiCaptureRoutes.ts`:

```ts
export type AiCaptureSemanticCandidates = Pick<
  AiSemanticCandidateService,
  'compare' | 'topicRelevance'
>;
```

Extend `createAiCaptureRouteDependencies(pool, workerClient, semanticCandidates?)` and `BuildAppOptions` with `aiCaptureSemanticCandidates?: AiCaptureSemanticCandidates`. When omitted, construct the existing real `AiSemanticCandidateService` exactly as today.

Create `mcpBenchmarkApi.ts` that starts `buildApp` on a benchmark-only loopback port using the real isolated PostgreSQL pool and this deterministic adapter:

```ts
const semanticCandidates: AiCaptureSemanticCandidates = {
  compare: async (_entityType, texts) => texts.map(() => []),
  topicRelevance: async (_topic, events) =>
    events.map((event) => ({ ref: event.ref, similarity: 1 })),
};
```

The adapter is allowed only in the benchmark entrypoint and tests. It does not pretend to measure semantic quality; exact/fuzzy database comparison, quality gates, plan validation, and plan persistence still use the real API and database.

Add `mcp-benchmark-api.test.ts` proving default `buildApp` still constructs the real semantic dependency while an explicit adapter is passed only to AI-capture routes. Verify no production server or Compose environment sets this option.

- [ ] **Step 5: Implement the isolated benchmark orchestrator**

`mcpBenchmarkApi.ts` owns the disposable database lifecycle. Follow the existing API benchmark pattern based on `GenericContainer('pgvector/pgvector:0.8.2-pg18')`: start the container, apply migrations, call `runSimulation` with the fixed counts and seed, start Fastify on loopback, and write a readiness file containing only API URL, batch ID, and inserted counts. On SIGINT, SIGTERM, startup failure, or normal shutdown, close Fastify, end the pool, and stop the container.

Model `scripts/run-mcp-benchmark.sh` after the cleanup discipline in `scripts/test-production-compose.sh`:

```bash
benchmark_temp_dir="$(mktemp -d)"
benchmark_api_port="${CAUSALITY_MCP_BENCHMARK_API_PORT:-19080}"
benchmark_mcp_port="${CAUSALITY_MCP_BENCHMARK_PORT:-19081}"
trap cleanup EXIT INT TERM
```

The script must:

1. validate both numeric loopback ports and require them to differ;
2. resolve the current Docker context into `DOCKER_HOST` and set `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock` using the same rule as existing integration commands;
3. start `pnpm --filter @causality/api mcp:benchmark-api` in the background with the readiness-file path and fixed `--events=10000 --relations=30000 --cases=100000 --seed=20260731`;
4. wait with a bounded deadline for the readiness file and parse only API URL, batch ID, and inserted counts;
5. start the normal MCP HTTP process on loopback with `CAUSALITY_API_URL` pointing to that API;
6. poll MCP health with a bounded deadline;
7. run the MCP benchmark client against those two processes;
8. write transient JSON under `test-results/`;
9. always terminate MCP and API process groups, wait for them, remove the temporary directory, and rely on the API process to stop its Testcontainer.

Do not start Web or Semantic Worker and do not read the user's `DATABASE_URL`. The cleanup trap must tolerate partially started processes and issue a final Docker label check proving no benchmark Testcontainer remains.

- [ ] **Step 6: Implement the MCP benchmark client**

The client fetches current settings directly from the benchmark API `/api/mcp/settings`, keeps the Token in memory, connects with `StreamableHTTPClientTransport`, and runs these named scenarios:

```ts
const scenarioNames = [
  'event_search_all_pages',
  'case_search_all_pages',
  'relation_search_all_pages',
  'event_case_relation_details',
  'local_graph_20',
  'local_graph_50',
  'local_graph_100',
  'causal_path_depth_10',
  'evidence_bundle',
  'candidate_compare_50_events',
  'prepare_skip_plan_50_events',
  'concurrent_readonly_sessions',
] as const;
```

Use the simulation `batchId` to search `SIM-${batchId}` and verify all pages have unique IDs and totals equal the inserted counts. Select real returned IDs for detail, graph, path, and evidence calls.

For the 50-event candidate comparison, use the first 50 exact simulated event names with no cases or relations. For plan generation, submit a complete decision set that skips all 50 candidates with the fixed reason “容量基准不写入知识数据”. Assert no commit Tool is called and the plan summary contains no business writes. Delete no records; the entire isolated volume is removed by cleanup.

Open several independent Clients for the concurrency scenario and close every Client in `finally`.

- [ ] **Step 7: Wire scripts and production contract assertions**

Add API workspace:

```json
{ "mcp:benchmark-api": "tsx src/database/benchmark/mcpBenchmarkApi.ts" }
```

Add workspace:

```json
{ "benchmark": "tsx src/benchmark/mcpBenchmarkClient.ts" }
```

Add root:

```json
{ "mcp:benchmark": "bash scripts/run-mcp-benchmark.sh" }
```

Extend `tests/production/e2e-contract.test.mjs` to assert the benchmark uses Testcontainers, uses distinct loopback API/MCP ports, uses fixed counts/seed, ignores the user's `DATABASE_URL`, never starts Web or Semantic Worker, has a cleanup trap, terminates process groups, removes its temporary directory, and checks for leaked benchmark containers.

- [ ] **Step 8: Run unit and script contract tests**

```bash
pnpm --filter @causality/api exec vitest run test/mcp-benchmark-api.test.ts
pnpm --filter @causality/mcp exec vitest run test/mcpBenchmarkMetrics.test.ts
pnpm test:compose
pnpm --filter @causality/api typecheck
pnpm --filter @causality/mcp typecheck
```

Expected: all pass.

- [ ] **Step 9: Run the complete benchmark once and record the baseline**

```bash
pnpm mcp:benchmark
```

Expected:

- dataset counts are exactly 10,000 events, 30,000 relations, and 100,000 cases;
- all named scenarios succeed;
- pagination has no duplicate or missing ID;
- bounded graph/path responses report correct truncation;
- cleanup removes the Testcontainer, child processes, and temporary files;
- `test-results/mcp-benchmark-summary.json` contains detailed measurements.

Create `docs/mcp-capacity-baseline.md` containing the date, machine/runtime context, dataset counts, one compact scenario table, correctness result, and the explicit statement that latency values are observational rather than release thresholds.

- [ ] **Step 10: Commit Task 6**

```bash
git add \
  package.json \
  apps/api/package.json \
  apps/api/src/app.ts \
  apps/api/src/features/ai-capture/aiCaptureRoutes.ts \
  apps/api/src/database/benchmark/mcpBenchmarkApi.ts \
  apps/api/test/mcp-benchmark-api.test.ts \
  apps/mcp/package.json \
  apps/mcp/src/benchmark \
  apps/mcp/test/mcpBenchmarkMetrics.test.ts \
  scripts/run-mcp-benchmark.sh \
  tests/production/e2e-contract.test.mjs \
  docs/mcp-capacity-baseline.md
git commit -m "test: add representative MCP capacity benchmark"
```

Do not add `test-results/`.

---

### Task 7: Publish Focused Guides, Run Release Gates, and Stop for Manual Review

**Files:**
- Modify: `README.md`
- Create: `docs/mcp-client-compatibility.md`
- Create: `docs/mcp-workflows.md`
- Modify: `docs/superpowers/specs/2026-07-31-p3-03-mcp-compatibility-usability-design.md`
- Modify: `docs/superpowers/plans/2026-07-20-causality-application-roadmap.md`
- Modify: `docs/superpowers/plans/2026-07-31-p3-03-mcp-compatibility-usability.md`

**Interfaces:**
- Produces: one short README entry, one compatibility/troubleshooting guide, one five-workflow guide, and the reviewed P3-03 release-candidate record.
- Consumes: all commands and stable behavior delivered by Tasks 1–6.

- [x] **Step 1: Write the client compatibility and diagnostic guide**

`docs/mcp-client-compatibility.md` must include these exact sections:

1. supported baseline and non-guarantees;
2. production Compose Streamable HTTP setup;
3. Codex CLI/Desktop setup;
4. generic Streamable HTTP JSON;
5. generic stdio command and environment;
6. MCP Inspector;
7. Token display, storage, rotation, and old-session behavior;
8. `pnpm mcp:check` text and JSON modes;
9. structured Tool error fields and categories;
10. troubleshooting table;
11. manual compatibility checklist.

The troubleshooting table must include service stopped, wrong port, missing/rotated Token, initialize failure, catalog mismatch, Tool-only clients, hidden Prompt/Resource, missing Skill, semantic enhancement unavailable, expired/replaced/invalidated plan, data-repair error, and system error.

Use `<TOKEN>`, `<MCP_URL>`, and `<PROJECT_PATH>` placeholders only in configuration examples; do not include a real Token, username, or absolute local path.

- [x] **Step 2: Write the five-workflow guide**

`docs/mcp-workflows.md` must have one self-contained recipe each for:

1. capture and confirmed import;
2. direct event causes/results;
3. directed path tracing;
4. causal-chain review;
5. downstream outcome inference.

Each recipe includes:

- an ordinary-language request in Chinese;
- MCP Prompt name;
- Codex Skill name;
- expected Tool sequence using exact Tool names;
- the user confirmation boundary;
- a normal readable output outline;
- at least two failure/recovery examples;
- the database fact/evidence/inference/write boundary.

Use stable fixed-seed examples such as “供应链中断”, “交付周期延长”, and “生产成本上升”. Do not depend on internet access or claim cross-model consistency.

- [x] **Step 3: Reduce README to the fast path and link both guides**

Keep the default production command, HTTP endpoint, configuration copy instructions, 15/5/4 overview, Codex `/mcp` and `/skills` notes, and security boundary. Move repeated long-form configuration, troubleshooting, and workflow explanations to the two guides.

Add:

```markdown
- [MCP 客户端兼容与诊断](docs/mcp-client-compatibility.md)
- [MCP 五条业务工作流](docs/mcp-workflows.md)
- [MCP 代表性容量基线](docs/mcp-capacity-baseline.md)
```

- [x] **Step 4: Run documentation consistency checks**

```bash
pnpm exec prettier --check \
  README.md \
  docs/mcp-client-compatibility.md \
  docs/mcp-workflows.md \
  docs/mcp-capacity-baseline.md \
  docs/superpowers/specs/2026-07-31-p3-03-mcp-compatibility-usability-design.md \
  docs/superpowers/plans/2026-07-20-causality-application-roadmap.md
rg -n "15 个 Tool|5 个 Prompt|4 个 Resource" README.md docs/mcp-*.md
rg -n "<TOKEN>|<MCP_URL>|<PROJECT_PATH>" docs/mcp-client-compatibility.md
```

Expected: formatting passes; capability counts agree; placeholder Tokens exist only in examples; no real 64-character Token is present.

- [x] **Step 5: Run every focused P3-03 gate**

```bash
pnpm --filter @causality/mcp test
pnpm test:mcp-compat
pnpm mcp:check
pnpm mcp:check -- --transport=stdio
pnpm mcp:benchmark
pnpm test:compose
```

Expected: all pass. Record exact test and benchmark totals in the design acceptance section.

- [x] **Step 6: Run the full repository release candidate gates**

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
pnpm test:production
pnpm audit --prod --audit-level=high
git diff --check
```

Expected: every command exits `0`. The existing lazy-loaded causal-graph bundle-size warning may be reported but is not a P3-03 failure because this stage does not modify the graph implementation.

- [x] **Step 7: Review the complete P3-03 diff**

Review against every section of the approved design and confirm:

- no public capability was renamed or added;
- success payloads remain compatible;
- all Tool business failures use the shared nested error;
- capture legacy fields remain;
- HTTP and stdio catalogs match;
- logs contain no secrets or full business content;
- diagnostics are read-only;
- benchmark uses and stops only its disposable Testcontainer and benchmark subprocesses;
- no Web, database migration, online AI, client-specific server branch, or cross-model suite was added;
- `research/` remains untouched and untracked.

- [x] **Step 8: Mark implementation complete but keep the manual gate open**

Update the design and roadmap to:

```text
P3-03 状态：实施完成，等待人工复核
```

Record actual commands, test totals, benchmark dataset, observed measurements, known non-blocking warnings, and the exact commit range. Do not mark P3-03 complete yet.

- [x] **Step 9: Commit the release candidate documentation**

```bash
git add \
  README.md \
  docs/mcp-client-compatibility.md \
  docs/mcp-workflows.md \
  docs/mcp-capacity-baseline.md \
  docs/superpowers/specs/2026-07-31-p3-03-mcp-compatibility-usability-design.md \
  docs/superpowers/plans/2026-07-20-causality-application-roadmap.md \
  docs/superpowers/plans/2026-07-31-p3-03-mcp-compatibility-usability.md
git commit -m "docs: prepare P3-03 MCP manual review"
```

- [ ] **Step 10: Stop for user manual verification**

Ask the user to verify:

1. Codex connects through copied Streamable HTTP configuration;
2. `/mcp` lists Causality and 15 Tools;
3. `/skills` lists all 5 Causality Skills;
4. all five ordinary-language workflows start correctly;
5. Tool-only operation remains possible without visible Prompt/Resource support;
6. disconnect/reconnect works;
7. Token rotation invalidates the old configuration and the new configuration reconnects;
8. a business error explains code, retryability, and next action;
9. logs contain request IDs and duration but no Token or complete business text;
10. `mcp:check` text is understandable and JSON output is machine-readable.

Do not proceed until the user explicitly approves.

- [ ] **Step 11: Close P3-03 only after explicit approval**

After user approval, update design and roadmap to `已完成`, record the manual review date, run Prettier and `git diff --check`, and commit only the two status documents:

```bash
git add \
  docs/superpowers/specs/2026-07-31-p3-03-mcp-compatibility-usability-design.md \
  docs/superpowers/plans/2026-07-20-causality-application-roadmap.md
git commit -m "docs: complete P3-03 MCP compatibility"
```

Do not push GitHub until the user separately requests it.

---

## Plan Self-Review Checklist

- [x] Every approved P3-03 design section maps to a Task and test gate.
- [x] No step renames, removes, or adds a public Tool, Prompt, or Resource.
- [x] Task interfaces use the same type and function names in later consumers.
- [x] All code-writing steps name exact files, signatures, behavior, and focused tests.
- [x] No step records Tokens, payloads, conversations, or complete business text.
- [x] Diagnostic and benchmark cleanup paths cover success, failure, timeout, and interruption.
- [x] The benchmark uses fixed counts and seed in a disposable Testcontainers PostgreSQL instance.
- [x] The final state stops at the manual review gate and does not push GitHub.
