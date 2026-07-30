# P3-01R1 Task 5 分析 Prompt 与只读 Resource Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 15 个 MCP 工具和 `causality_capture` Prompt 之上新增三个自包含分析 Prompt、三份便携 Prompt、三个轻量 Skill 和四个固定只读 Resource，使外部 AI 能够用数据库事实分析事件、路径和因果链，并安全读取本地能力与系统状态。

**Architecture:** MCP 内部新增统一能力 manifest、共享分析规范、三个独立 Prompt builder 和 Resource 注册模块。静态 Resource 直接从 canonical 规范和 manifest 生成；动态系统状态 Resource 通过现有 API 健康、就绪和语义生命周期端点并行聚合，不访问数据库或修改业务数据。Streamable HTTP 与 stdio 继续复用同一个 Server 工厂，Prompt 和便携 Markdown 保持字节一致。

**Tech Stack:** TypeScript 6.0、Node.js 24、`@modelcontextprotocol/sdk` 1.30.0、Zod 4.4.3、Vitest 4.1.10、pnpm workspace、现有 Fastify API 与 PostgreSQL/语义生命周期契约。

## Global Constraints

- 最终能力固定为 15 个工具、4 个 Prompt 和 4 个固定 URI Resource；不得新增 Resource Template。
- 新 Prompt 固定命名为 `causality_analyze_event`、`causality_trace_path`、`causality_review_chain`，且都不接收业务参数。
- 新 Resource 固定为 `causality://rules/domain-model`、`causality://rules/capture`、`causality://capabilities`、`causality://system/status`。
- 分析 Prompt 只能编排十个知识与证据工具，不能调用五个采集工具。
- 默认只依据 Causality 数据库；外部信息只有用户明确要求时才能作为独立章节出现。
- 事件分析首次最多显示 5 条直接关系、每条最多 3 个案例；单次最多检查 100 条直接关系。
- 路径追踪默认最大深度 5、读取最多 10 条路径、展示最多 3 条，完整展开第一条；服务端扩展状态上限保持 10,000。
- 因果链单次最多审查 10 个相邻关系段；不计算路径平均置信度、整体概率或真假评分。
- 系统状态远程检查使用 5,000 ms 上限，不缓存结果，不返回令牌、内部 URL、堆栈、环境变量或业务记录统计。
- 不增加数据库业务表、迁移、Web 页面、应用内在线 AI、联网抓取、通用写工具或分析结果自动入库。
- 保持现有 15 个工具及 `causality_capture` Prompt 向后兼容。
- 只暂存每个任务明确列出的文件；不得提交用户现有的 `.gitignore`、`README.md`、Task 2 设计改动、`docs/user-guide.md` 或 `research/`。
- Task 5 人工复核通过前不得标记 Task 5 或 P3-01R1 完成，不推送 GitHub，不自动进入 P3-02。

## File Structure

### New focused modules

- `apps/mcp/src/capabilities/capabilityManifest.ts`：能力名称、用途、访问属性和稳定限制的唯一清单。
- `apps/mcp/src/prompts/analysisPolicy.ts`：领域规则、共享分析安全规则和工具白名单文本。
- `apps/mcp/src/prompts/analyzeEventPrompt.ts`：事件直接原因/结果分析 Prompt builder。
- `apps/mcp/src/prompts/tracePathPrompt.ts`：两事件有向路径追踪 Prompt builder。
- `apps/mcp/src/prompts/reviewChainPrompt.ts`：逐段因果链审查 Prompt builder。
- `apps/mcp/src/prompts/registerAnalysisPrompts.ts`：三个无参数 Prompt 的 MCP 注册入口。
- `apps/mcp/src/resources/resourceSchemas.ts`：能力 JSON 和系统状态 JSON 的严格本地 Schema。
- `apps/mcp/src/resources/staticResourceContent.ts`：领域、采集和能力 Resource 内容生成。
- `apps/mcp/src/resources/systemStatusResource.ts`：系统状态并行聚合及安全降级逻辑。
- `apps/mcp/src/resources/registerResources.ts`：四个固定 Resource 的统一 MCP 注册入口。
- `apps/mcp/test/capabilityManifest.test.ts`：manifest 唯一性和限制回归。
- `apps/mcp/test/analysisPrompts.test.ts`：三个 Prompt、便携文件和 Skill 回归。
- `apps/mcp/test/resources.test.ts`：四个 Resource 列表、静态内容和能力 JSON 回归。
- `apps/mcp/test/systemStatusResource.test.ts`：系统状态成功、降级、不可用和脱敏回归。
- `prompts/causality-analyze-event.md`、`prompts/causality-trace-path.md`、`prompts/causality-review-chain.md`：canonical builder 生成的便携 Prompt。
- `skills/causality-analyze-event/SKILL.md`、`skills/causality-trace-path/SKILL.md`、`skills/causality-review-chain/SKILL.md`：不复制业务规则的轻量启动器。

### Existing modules changed in place

- `apps/mcp/src/tools/registerKnowledgeTools.ts`、`registerEvidenceTools.ts`、`registerCaptureTools.ts`：工具注册名称改用 manifest 常量，不改变 Schema 或行为。
- `apps/mcp/src/prompts/capturePrompt.ts`：Prompt 名称改用统一常量，不改变文本。
- `apps/mcp/src/prompts/generatePortablePrompt.ts`：一次生成四份便携 Prompt。
- `apps/mcp/src/api/causalityApiClient.ts`：新增三个 5 秒只读状态方法和受控响应状态支持。
- `apps/mcp/src/server/createMcpServer.ts`：注册三个分析 Prompt 和四个 Resource，并扩展组合 API 类型。
- `apps/mcp/test/causalityApiClient.test.ts`、`knowledgeTools.test.ts`、`httpTransport.test.ts`、`stdioTransport.test.ts`：最终能力和传输一致性回归。

---

### Task 1: 建立统一能力 manifest 并绑定现有注册名称

**Files:**

- Create: `apps/mcp/src/capabilities/capabilityManifest.ts`
- Create: `apps/mcp/test/capabilityManifest.test.ts`
- Modify: `apps/mcp/src/tools/registerKnowledgeTools.ts`
- Modify: `apps/mcp/src/tools/registerEvidenceTools.ts`
- Modify: `apps/mcp/src/tools/registerCaptureTools.ts`
- Modify: `apps/mcp/src/prompts/capturePrompt.ts`

**Interfaces:**

- Consumes: 现有 15 个工具名称、`causality_capture` 名称和 Task 5 固定 Prompt/Resource 名称。
- Produces: `CAUSALITY_MCP_NAME`、`CAUSALITY_MCP_VERSION`、`MCP_TOOL_NAMES`、`MCP_PROMPT_NAMES`、`MCP_RESOURCE_URIS`、`MCP_CAPABILITY_MANIFEST`。

- [ ] **Step 1: 写 manifest 唯一性和内容失败测试**

新建 `capabilityManifest.test.ts`，断言名称和访问属性：

```ts
import { describe, expect, it } from 'vitest';

import {
  MCP_CAPABILITY_MANIFEST,
  MCP_PROMPT_NAMES,
  MCP_RESOURCE_URIS,
  MCP_TOOL_NAMES,
} from '../src/capabilities/capabilityManifest.js';

describe('MCP capability manifest', () => {
  it('defines the final unique capability names', () => {
    const tools = Object.values(MCP_TOOL_NAMES);
    const prompts = Object.values(MCP_PROMPT_NAMES);
    const resources = Object.values(MCP_RESOURCE_URIS);

    expect(tools).toHaveLength(15);
    expect(new Set(tools).size).toBe(15);
    expect(prompts).toEqual([
      'causality_capture',
      'causality_analyze_event',
      'causality_trace_path',
      'causality_review_chain',
    ]);
    expect(resources).toEqual([
      'causality://rules/domain-model',
      'causality://rules/capture',
      'causality://capabilities',
      'causality://system/status',
    ]);
  });

  it('classifies only plan preparation and commit as controlled writes', () => {
    expect(
      MCP_CAPABILITY_MANIFEST.tools
        .filter((tool) => tool.access === 'controlled_write')
        .map((tool) => tool.name),
    ).toEqual(['prepare_knowledge_changes', 'commit_knowledge_changes']);
  });

  it('publishes the exact stable analysis limits', () => {
    expect(MCP_CAPABILITY_MANIFEST.limits).toEqual({
      eventAnalysisInspectedRelations: 100,
      eventAnalysisDisplayedRelations: 5,
      casesPerDisplayedRelation: 3,
      pathDefaultDepth: 5,
      pathMaximumDepth: 10,
      pathQueryLimit: 10,
      pathDisplayedLimit: 3,
      pathExpandedStateLimit: 10_000,
      chainSegmentLimit: 10,
    });
  });
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```bash
pnpm --filter @causality/mcp exec vitest run test/capabilityManifest.test.ts
```

Expected: FAIL，`capabilityManifest.ts` 尚不存在。

- [ ] **Step 3: 实现能力常量和 manifest**

创建 `capabilityManifest.ts`。工具常量必须完整列出：

```ts
export const CAUSALITY_MCP_NAME = 'causality';
export const CAUSALITY_MCP_VERSION = '0.1.0';

export const MCP_TOOL_NAMES = {
  searchAtomicEvents: 'search_atomic_events',
  getAtomicEvent: 'get_atomic_event',
  searchConcreteCases: 'search_concrete_cases',
  getCausalRelation: 'get_causal_relation',
  getRelationCases: 'get_relation_cases',
  queryLocalCausalGraph: 'query_local_causal_graph',
  getConcreteCase: 'get_concrete_case',
  searchCausalRelations: 'search_causal_relations',
  findCausalPaths: 'find_causal_paths',
  getCausalEvidenceBundle: 'get_causal_evidence_bundle',
  compareKnowledgeCandidates: 'compare_knowledge_candidates',
  prepareKnowledgeChanges: 'prepare_knowledge_changes',
  getImportPlanStatus: 'get_import_plan_status',
  commitKnowledgeChanges: 'commit_knowledge_changes',
  getImportResult: 'get_import_result',
} as const;

export const MCP_PROMPT_NAMES = {
  capture: 'causality_capture',
  analyzeEvent: 'causality_analyze_event',
  tracePath: 'causality_trace_path',
  reviewChain: 'causality_review_chain',
} as const;

export const MCP_RESOURCE_URIS = {
  domainModel: 'causality://rules/domain-model',
  captureRules: 'causality://rules/capture',
  capabilities: 'causality://capabilities',
  systemStatus: 'causality://system/status',
} as const;
```

`MCP_CAPABILITY_MANIFEST` 使用 `schemaVersion: 1`，为 15 个工具提供中文 `purpose` 和 `access: 'read_only' | 'controlled_write'`，并提供 4 个 Prompt、4 个 Resource、上述固定 `limits` 以及兼容说明“Prompt 或 Resource 不可用时仍可独立调用工具”。不得放入 URL、令牌或环境变量。

- [ ] **Step 4: 把现有注册名称替换为常量**

在三个 `register*Tools.ts` 中只替换 `server.registerTool()` 的第一个参数，例如：

```ts
server.registerTool(MCP_TOOL_NAMES.searchAtomicEvents, config, callback);
```

在 `capturePrompt.ts` 中保持旧导出兼容：

```ts
export const CAUSALITY_CAPTURE_PROMPT_NAME = MCP_PROMPT_NAMES.capture;
```

不得修改 input/output Schema、annotations、标题、描述或处理函数。

- [ ] **Step 5: 运行 manifest 与原 MCP 回归**

Run:

```bash
pnpm --filter @causality/mcp exec vitest run test/capabilityManifest.test.ts test/knowledgeTools.test.ts test/evidenceTools.test.ts test/captureTools.test.ts test/capturePrompt.test.ts
pnpm --filter @causality/mcp typecheck
```

Expected: 全部 PASS，现有 15 个工具和 `causality_capture` 行为不变。

- [ ] **Step 6: 提交 Task 1**

```bash
git add apps/mcp/src/capabilities/capabilityManifest.ts apps/mcp/test/capabilityManifest.test.ts apps/mcp/src/tools/registerKnowledgeTools.ts apps/mcp/src/tools/registerEvidenceTools.ts apps/mcp/src/tools/registerCaptureTools.ts apps/mcp/src/prompts/capturePrompt.ts
git commit -m "refactor: centralize MCP capability names"
```

---

### Task 2: 实现共享分析规范和三个 canonical Prompt builder

**Files:**

- Create: `apps/mcp/src/prompts/analysisPolicy.ts`
- Create: `apps/mcp/src/prompts/analyzeEventPrompt.ts`
- Create: `apps/mcp/src/prompts/tracePathPrompt.ts`
- Create: `apps/mcp/src/prompts/reviewChainPrompt.ts`
- Create: `apps/mcp/test/analysisPrompts.test.ts`

**Interfaces:**

- Consumes: `MCP_TOOL_NAMES`、Task 5 固定限制和设计文档中的输出分类。
- Produces: `buildDomainModelRules()`、`buildSharedAnalysisPolicy()`、`buildAnalyzeEventPrompt()`、`buildTracePathPrompt()`、`buildReviewChainPrompt()`。

- [ ] **Step 1: 写共享规范失败测试**

在 `analysisPrompts.test.ts` 先断言三个 builder 和关键安全规则：

```ts
const prompts = [buildAnalyzeEventPrompt(), buildTracePathPrompt(), buildReviewChainPrompt()];

it('keeps every analysis prompt database-first and read-only', () => {
  for (const prompt of prompts) {
    expect(prompt).toContain('从当前可见会话');
    expect(prompt).toContain('无法可靠匹配时停止数据库分析');
    expect(prompt).toContain('外部信息');
    expect(prompt).toContain('无案例依据');
    expect(prompt).toContain('不得调用采集工具');
    expect(prompt).toContain('不计算整体发生概率');
    expect(prompt).toContain('默认不显示数据库 UUID');
    expect(prompt).toContain('不直接展示工具 JSON');
    expect(prompt).toContain('增强查询不可用');
    expect(prompt).toContain('重新查询路径一次');
    expect(prompt).toContain('案例证据未加载');
    expect(prompt).toContain('不得自动写入数据库');
  }
});

it('publishes the exact read-tool allowlist and capture-tool denylist', () => {
  const prompt = buildAnalyzeEventPrompt();
  expect(ANALYSIS_READ_TOOL_NAMES).toEqual([
    'search_atomic_events',
    'get_atomic_event',
    'search_concrete_cases',
    'get_causal_relation',
    'get_relation_cases',
    'query_local_causal_graph',
    'get_concrete_case',
    'search_causal_relations',
    'find_causal_paths',
    'get_causal_evidence_bundle',
  ]);
  for (const name of ANALYSIS_READ_TOOL_NAMES) {
    expect(prompt).toContain(name);
  }
  expect(ANALYSIS_DENIED_TOOL_NAMES).toEqual([
    'compare_knowledge_candidates',
    'prepare_knowledge_changes',
    'get_import_plan_status',
    'commit_knowledge_changes',
    'get_import_result',
  ]);
  for (const name of ANALYSIS_DENIED_TOOL_NAMES) {
    expect(prompt).toContain(name);
  }
});
```

- [ ] **Step 2: 写三个任务特有流程失败测试**

断言事件分析包含 `100`、`5`、`3`、直接关系和逐层追问；路径 Prompt 包含默认深度 5、最多 10 条、展示 3 条、完整展开第一条和 `10,000` 截断语义；链审查包含 10 段与五种准确分类：

```ts
expect(buildReviewChainPrompt()).toContain('库内有直接关系与案例依据');
expect(buildReviewChainPrompt()).toContain('库内有直接关系，但无案例依据');
expect(buildReviewChainPrompt()).toContain('仅有间接路径支持');
expect(buildReviewChainPrompt()).toContain('只存在反向关系');
expect(buildReviewChainPrompt()).toContain('库内未找到支持');
expect(buildReviewChainPrompt()).toContain('A → X → B');
expect(buildReviewChainPrompt()).toContain('不生成整条链的真假评分');
```

- [ ] **Step 3: 运行测试并确认 RED**

Run:

```bash
pnpm --filter @causality/mcp exec vitest run test/analysisPrompts.test.ts
```

Expected: FAIL，四个 Prompt 模块尚不存在。

- [ ] **Step 4: 实现领域与共享规范**

`analysisPolicy.ts` 导出：

```ts
export const ANALYSIS_READ_TOOL_NAMES = [
  MCP_TOOL_NAMES.searchAtomicEvents,
  MCP_TOOL_NAMES.getAtomicEvent,
  MCP_TOOL_NAMES.searchConcreteCases,
  MCP_TOOL_NAMES.getCausalRelation,
  MCP_TOOL_NAMES.getRelationCases,
  MCP_TOOL_NAMES.queryLocalCausalGraph,
  MCP_TOOL_NAMES.getConcreteCase,
  MCP_TOOL_NAMES.searchCausalRelations,
  MCP_TOOL_NAMES.findCausalPaths,
  MCP_TOOL_NAMES.getCausalEvidenceBundle,
] as const;

export const ANALYSIS_DENIED_TOOL_NAMES = [
  MCP_TOOL_NAMES.compareKnowledgeCandidates,
  MCP_TOOL_NAMES.prepareKnowledgeChanges,
  MCP_TOOL_NAMES.getImportPlanStatus,
  MCP_TOOL_NAMES.commitKnowledgeChanges,
  MCP_TOOL_NAMES.getImportResult,
] as const;

export function buildDomainModelRules(): string;
export function buildSharedAnalysisPolicy(): string;
```

`buildDomainModelRules()` 必须完整说明原子事件、真实案例、直接/间接关系、置信度、案例数、路径最低置信度、无案例表达和数据库/外部信息边界。`buildSharedAnalysisPolicy()` 嵌入领域规则、十个允许工具、五个禁止工具、普通后增强匹配、歧义询问、无匹配停止、截断披露、外部信息分区、不写库、默认隐藏 UUID/工具 JSON、增强查询失败、证据路径失效时最多重查一次以及案例加载失败的准确表达。

- [ ] **Step 5: 实现三个自包含 Prompt builder**

每个 builder 返回 Markdown 字符串并直接嵌入 `buildSharedAnalysisPolicy()`。标题和版本固定：

```ts
export function buildAnalyzeEventPrompt(): string {
  return `# Causality 事件原因与结果分析

规则版本：V1

${buildSharedAnalysisPolicy()}

## 本流程
...`;
}
```

事件 Prompt 必须写出普通搜索→增强搜索→歧义询问、只取直接关系、检查 100/显示 5/案例 3、案例数与置信度排序、六段输出。路径 Prompt 写出端点分别匹配、默认 `maxDepth=5/pathLimit=10/minConfidence=0/minCaseCount=0`、展示 3、第一条证据包案例限制 3、截断时的两种准确措辞。链审查 Prompt 写出十段限制、直接→间接→反向检查顺序、五类状态、间接兼有反向警告和六段输出。

- [ ] **Step 6: 运行 Prompt 测试和格式检查**

Run:

```bash
pnpm --filter @causality/mcp exec vitest run test/analysisPrompts.test.ts
pnpm --filter @causality/mcp typecheck
pnpm exec prettier --check apps/mcp/src/prompts/analysisPolicy.ts apps/mcp/src/prompts/analyzeEventPrompt.ts apps/mcp/src/prompts/tracePathPrompt.ts apps/mcp/src/prompts/reviewChainPrompt.ts apps/mcp/test/analysisPrompts.test.ts
```

Expected: 全部 PASS。

- [ ] **Step 7: 提交 Task 2**

```bash
git add apps/mcp/src/prompts/analysisPolicy.ts apps/mcp/src/prompts/analyzeEventPrompt.ts apps/mcp/src/prompts/tracePathPrompt.ts apps/mcp/src/prompts/reviewChainPrompt.ts apps/mcp/test/analysisPrompts.test.ts
git commit -m "feat: define canonical causal analysis prompts"
```

---

### Task 3: 注册分析 Prompt 并生成便携 Prompt 与 Skill

**Files:**

- Create: `apps/mcp/src/prompts/registerAnalysisPrompts.ts`
- Create: `prompts/causality-analyze-event.md`
- Create: `prompts/causality-trace-path.md`
- Create: `prompts/causality-review-chain.md`
- Create: `skills/causality-analyze-event/SKILL.md`
- Create: `skills/causality-trace-path/SKILL.md`
- Create: `skills/causality-review-chain/SKILL.md`
- Modify: `apps/mcp/src/prompts/generatePortablePrompt.ts`
- Modify: `apps/mcp/src/server/createMcpServer.ts`
- Modify: `apps/mcp/test/analysisPrompts.test.ts`
- Modify: `apps/mcp/test/knowledgeTools.test.ts`
- Modify: `apps/mcp/test/stdioTransport.test.ts`

**Interfaces:**

- Consumes: 三个 canonical builder 与 `MCP_PROMPT_NAMES`。
- Produces: `registerAnalysisPrompts(server: McpServer): void`、4 个 MCP Prompt、三份便携 Markdown 和三份薄 Skill。

- [ ] **Step 1: 写 Prompt 注册失败测试**

使用 `InMemoryTransport` 创建 Server/Client，调用 `registerCapturePrompt()` 和尚未实现的 `registerAnalysisPrompts()`：

```ts
const listed = await client.listPrompts();
expect(listed.prompts.map((prompt) => prompt.name)).toEqual(Object.values(MCP_PROMPT_NAMES));
for (const prompt of listed.prompts) expect(prompt.arguments ?? []).toEqual([]);

const result = await client.getPrompt({ name: MCP_PROMPT_NAMES.analyzeEvent });
expect(result.messages).toEqual([
  { role: 'user', content: { type: 'text', text: buildAnalyzeEventPrompt() } },
]);
```

- [ ] **Step 2: 写 portable/Skill 失败测试**

读取三份目标 Markdown，分别与 builder 严格相等；读取 Skill 并断言包含对应 MCP 名称和 Markdown 路径，但不包含 `最多检查 100`、`10,000`、五种链路分类等业务规则。

- [ ] **Step 3: 运行测试并确认 RED**

Run:

```bash
pnpm --filter @causality/mcp exec vitest run test/analysisPrompts.test.ts test/knowledgeTools.test.ts test/stdioTransport.test.ts
```

Expected: FAIL，新注册器、便携文件和 Skill 尚不存在，Prompt 总数仍为 1。

- [ ] **Step 4: 实现三个无参数 Prompt 注册**

`registerAnalysisPrompts.ts` 对三个 Prompt 各调用一次 `server.registerPrompt`，不提供 `argsSchema`：

```ts
server.registerPrompt(
  MCP_PROMPT_NAMES.analyzeEvent,
  {
    title: '分析事件的直接原因与结果',
    description: '从当前可见会话识别目标事件，并用 Causality 数据库分析直接原因或结果。',
  },
  async () => ({
    description: 'Causality 事件原因与结果分析流程',
    messages: [{ role: 'user', content: { type: 'text', text: buildAnalyzeEventPrompt() } }],
  }),
);
```

路径和链审查使用各自 builder、标题和描述。`createMcpServer.ts` 在 `registerCapturePrompt(server)` 后调用 `registerAnalysisPrompts(server)`。

- [ ] **Step 5: 扩展统一便携 Prompt 生成器**

把现有单文件脚本改为显式目标数组：

```ts
const outputs = [
  ['causality-capture.md', buildCausalityCapturePrompt()],
  ['causality-analyze-event.md', buildAnalyzeEventPrompt()],
  ['causality-trace-path.md', buildTracePathPrompt()],
  ['causality-review-chain.md', buildReviewChainPrompt()],
] as const;

await Promise.all(outputs.map(([name, content]) => writeFile(resolve(promptDirectory, name), content, 'utf8')));
```

运行：

```bash
pnpm --filter @causality/mcp prompt:generate
```

- [ ] **Step 6: 创建三个薄 Skill**

每个 Skill 使用现有 `causality-capture` 的结构。以事件分析为例：

```md
---
name: causality-analyze-event
description: Launch the read-only Causality event cause and result analysis workflow for the current visible conversation.
---

# Causality Analyze Event

1. Prefer the connected MCP Prompt `causality_analyze_event`.
2. If MCP Prompts are unavailable, load `prompts/causality-analyze-event.md` and follow it exactly.
3. Keep the workflow read-only; do not start capture or import unless the user separately requests it.
```

路径和链审查 Skill 只替换名称、用途和对应文件路径。

- [ ] **Step 7: 更新最终 Prompt 清单回归并运行测试**

把 `knowledgeTools.test.ts` 和 `stdioTransport.test.ts` 的 Prompt 预期改为 `Object.values(MCP_PROMPT_NAMES)`。运行：

```bash
pnpm --filter @causality/mcp exec vitest run test/analysisPrompts.test.ts test/capturePrompt.test.ts test/knowledgeTools.test.ts test/stdioTransport.test.ts
pnpm --filter @causality/mcp typecheck
```

Expected: 全部 PASS，工具仍为 15，Prompt 为 4。

- [ ] **Step 8: 提交 Task 3**

```bash
git add apps/mcp/src/prompts/registerAnalysisPrompts.ts apps/mcp/src/prompts/generatePortablePrompt.ts apps/mcp/src/server/createMcpServer.ts apps/mcp/test/analysisPrompts.test.ts apps/mcp/test/knowledgeTools.test.ts apps/mcp/test/stdioTransport.test.ts prompts/causality-analyze-event.md prompts/causality-trace-path.md prompts/causality-review-chain.md skills/causality-analyze-event/SKILL.md skills/causality-trace-path/SKILL.md skills/causality-review-chain/SKILL.md
git commit -m "feat: expose portable causal analysis prompts"
```

---

### Task 4: 实现领域、采集与能力静态 Resource

**Files:**

- Create: `apps/mcp/src/resources/resourceSchemas.ts`
- Create: `apps/mcp/src/resources/staticResourceContent.ts`
- Create: `apps/mcp/src/resources/registerResources.ts`
- Create: `apps/mcp/test/resources.test.ts`
- Modify: `apps/mcp/src/server/createMcpServer.ts`

**Interfaces:**

- Consumes: `buildDomainModelRules()`、`buildCausalityCapturePrompt()`、`MCP_CAPABILITY_MANIFEST`、三个静态 URI。
- Produces: `capabilityManifestSchema`、`registerStaticResources(server: McpServer): void`；系统状态注册由 Task 6 添加到同一公开 `registerResources()` 入口。

- [ ] **Step 1: 写静态 Resource 列表和读取失败测试**

通过 InMemory Client 断言前三个静态 URI、MIME 类型和文本：

```ts
const listed = await client.listResources();
expect(listed.resources.map((resource) => resource.uri)).toEqual([
  MCP_RESOURCE_URIS.domainModel,
  MCP_RESOURCE_URIS.captureRules,
  MCP_RESOURCE_URIS.capabilities,
]);

const domain = await client.readResource({ uri: MCP_RESOURCE_URIS.domainModel });
expect(domain.contents[0]).toMatchObject({
  uri: MCP_RESOURCE_URIS.domainModel,
  mimeType: 'text/markdown',
  text: buildDomainModelRules(),
});
```

采集 Resource 文本必须等于 `buildCausalityCapturePrompt()`。能力 Resource 的 `text` 解析 JSON 后必须通过 `capabilityManifestSchema`，并断言 15/4/4 数量和固定 limits。

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```bash
pnpm --filter @causality/mcp exec vitest run test/resources.test.ts
```

Expected: FAIL，Resource 模块尚不存在。

- [ ] **Step 3: 实现严格能力 Schema 和静态内容 builder**

`resourceSchemas.ts` 使用 `.strict()` 定义能力 JSON：

```ts
export const capabilityManifestSchema = z.object({
  schemaVersion: z.literal(1),
  server: z.object({ name: z.literal('causality'), version: z.string().min(1) }).strict(),
  tools: z.array(z.object({
    name: z.string().min(1),
    purpose: z.string().min(1),
    access: z.enum(['read_only', 'controlled_write']),
  }).strict()).length(15),
  prompts: z.array(z.object({ name: z.string().min(1), purpose: z.string().min(1) }).strict()).length(4),
  resources: z.array(z.object({ uri: z.string().startsWith('causality://'), purpose: z.string().min(1) }).strict()).length(4),
  limits: z.object({
    eventAnalysisInspectedRelations: z.literal(100),
    eventAnalysisDisplayedRelations: z.literal(5),
    casesPerDisplayedRelation: z.literal(3),
    pathDefaultDepth: z.literal(5),
    pathMaximumDepth: z.literal(10),
    pathQueryLimit: z.literal(10),
    pathDisplayedLimit: z.literal(3),
    pathExpandedStateLimit: z.literal(10_000),
    chainSegmentLimit: z.literal(10),
  }).strict(),
  compatibility: z.object({ toolsWorkWithoutPromptsOrResources: z.literal(true) }).strict(),
}).strict();
```

`staticResourceContent.ts` 在返回 JSON 前执行 `capabilityManifestSchema.parse(MCP_CAPABILITY_MANIFEST)`，再使用 `JSON.stringify(value, null, 2)`。

- [ ] **Step 4: 注册三个固定静态 Resource**

`registerResources.ts` 首先导出 `registerStaticResources()`。每个回调返回一个 text content，显式带 URI 与 MIME：

```ts
server.registerResource(
  'causality-domain-model-rules',
  MCP_RESOURCE_URIS.domainModel,
  { title: 'Causality 领域建模规则', description: '原子事件、案例、关系和证据边界。', mimeType: 'text/markdown' },
  async () => ({
    contents: [{ uri: MCP_RESOURCE_URIS.domainModel, mimeType: 'text/markdown', text: buildDomainModelRules() }],
  }),
);
```

采集和能力 Resource 使用独立注册块。`createMcpServer.ts` 调用 `registerStaticResources(server)`；Task 6 再替换为统一 `registerResources(server, apiClient)`。

- [ ] **Step 5: 运行静态 Resource 和 Server 回归**

Run:

```bash
pnpm --filter @causality/mcp exec vitest run test/resources.test.ts test/knowledgeTools.test.ts
pnpm --filter @causality/mcp typecheck
```

Expected: 三个静态 Resource 可列出和读取，15 个工具和 4 个 Prompt 不变。

- [ ] **Step 6: 提交 Task 4**

```bash
git add apps/mcp/src/resources/resourceSchemas.ts apps/mcp/src/resources/staticResourceContent.ts apps/mcp/src/resources/registerResources.ts apps/mcp/test/resources.test.ts apps/mcp/src/server/createMcpServer.ts
git commit -m "feat: expose static MCP knowledge resources"
```

---

### Task 5: 扩展 API client 的只读系统状态读取

**Files:**

- Modify: `apps/mcp/src/api/causalityApiClient.ts`
- Modify: `apps/mcp/test/causalityApiClient.test.ts`

**Interfaces:**

- Consumes: `healthResponseSchema`、`readinessResponseSchema`、`semanticLifecycleSnapshotSchema`。
- Produces: `getHealth(timeoutMs?: number)`、`getReadiness(timeoutMs?: number)`、`getSemanticLifecycle(timeoutMs?: number)`；三个方法默认 5,000 ms 且不发送受保护令牌。

- [ ] **Step 1: 写三个状态请求失败测试**

在 API client 测试的 fake fetch 中为三个路径返回合法契约，并断言：

```ts
await expect(client.getHealth()).resolves.toEqual({ status: 'ok', service: 'causality-api' });
await expect(client.getReadiness()).resolves.toEqual({ status: 'not_ready', database: 'unavailable' });
await expect(client.getSemanticLifecycle()).resolves.toEqual(lifecycleSnapshot);

expect(calls.map((call) => call.path)).toEqual([
  '/api/health',
  '/api/ready',
  '/api/semantic/lifecycle',
]);
expect(calls.every((call) => call.token === null)).toBe(true);
```

`/api/ready` 返回 HTTP 503 和合法 `not_ready` body 时必须 resolve，而不是抛 API error。

- [ ] **Step 2: 写单次 5 秒超时和非法响应失败测试**

使用 fake timers 或传入立即监听 abort signal 的 fetch：调用 `getHealth(5_000)` 后推进 5,000 ms，断言错误为 `API_REQUEST_ABORTED`。非法 lifecycle body 断言 `INVALID_API_RESPONSE`。

- [ ] **Step 3: 运行测试并确认 RED**

Run:

```bash
pnpm --filter @causality/mcp exec vitest run test/causalityApiClient.test.ts
```

Expected: FAIL，三个方法和 request overrides 尚不存在。

- [ ] **Step 4: 扩展安全的 request 选项**

把私有选项扩展为：

```ts
interface RequestOptions<T> {
  schema: z.ZodType<T>;
  query?: Record<string, string | number | undefined>;
  method?: 'GET' | 'POST';
  body?: unknown;
  protected?: boolean;
  timeoutMs?: number;
  acceptedStatuses?: readonly number[];
}
```

计时器使用 `options.timeoutMs ?? this.timeoutMs`。响应处理改为只在 `!response.ok` 且 status 不在 `acceptedStatuses` 时调用 `apiFailure()`。即使状态被接受，仍必须通过输出 Schema。

- [ ] **Step 5: 实现三个公开只读方法**

```ts
const STATUS_TIMEOUT_MS = 5_000;

public getHealth(timeoutMs = STATUS_TIMEOUT_MS): Promise<HealthResponse> {
  return this.request('/api/health', { schema: healthResponseSchema, timeoutMs });
}

public getReadiness(timeoutMs = STATUS_TIMEOUT_MS): Promise<ReadinessResponse> {
  return this.request('/api/ready', {
    schema: readinessResponseSchema,
    acceptedStatuses: [503],
    timeoutMs,
  });
}

public getSemanticLifecycle(timeoutMs = STATUS_TIMEOUT_MS): Promise<SemanticLifecycleSnapshot> {
  return this.request('/api/semantic/lifecycle', {
    schema: semanticLifecycleSnapshotSchema,
    timeoutMs,
  });
}
```

三者不设置 `protected: true`，因此不会发送 `x-causality-mcp-token`。

- [ ] **Step 6: 运行 client 测试、类型与 lint**

Run:

```bash
pnpm --filter @causality/mcp exec vitest run test/causalityApiClient.test.ts
pnpm --filter @causality/mcp typecheck
pnpm eslint apps/mcp/src/api/causalityApiClient.ts apps/mcp/test/causalityApiClient.test.ts
```

Expected: 全部 PASS。

- [ ] **Step 7: 提交 Task 5**

```bash
git add apps/mcp/src/api/causalityApiClient.ts apps/mcp/test/causalityApiClient.test.ts
git commit -m "feat: add read-only MCP system status client"
```

---

### Task 6: 聚合并注册动态系统状态 Resource

**Files:**

- Create: `apps/mcp/src/resources/systemStatusResource.ts`
- Create: `apps/mcp/test/systemStatusResource.test.ts`
- Modify: `apps/mcp/src/resources/resourceSchemas.ts`
- Modify: `apps/mcp/src/resources/registerResources.ts`
- Modify: `apps/mcp/src/server/createMcpServer.ts`
- Modify: `apps/mcp/test/resources.test.ts`

**Interfaces:**

- Consumes: `HealthResponse`、`ReadinessResponse`、`SemanticLifecycleSnapshot` 和三个 Task 5 client 方法。
- Produces: `CausalityStatusApi`、`buildSystemStatusResource(api, options)`、`systemStatusResourceSchema`、`registerResources(server, api)`。

- [ ] **Step 1: 写完整 ready 状态失败测试**

定义 Fake API，全部调用成功。固定 clock 为 `2026-07-30T12:00:00.000Z`，断言：

```ts
expect(await buildSystemStatusResource(api, { now, serverVersion: '0.1.0' })).toEqual({
  schemaVersion: 1,
  generatedAt: '2026-07-30T12:00:00.000Z',
  overallStatus: 'ready',
  mcp: { status: 'online', name: 'causality', version: '0.1.0' },
  api: { status: 'online', reason: null },
  database: { status: 'ready', reason: null },
  semantic: {
    status: 'ready',
    workerStatus: 'online',
    modelState: 'loaded',
    currentModelCode: lifecycle.currentModelCode,
    currentModelFileState: 'downloaded',
    indexStatus: 'ready',
  },
  enhancedQuery: { available: true, reason: null },
});
```

- [ ] **Step 2: 写 degraded/unavailable 和脱敏失败测试**

覆盖：

1. API/DB 正常但 Worker unreachable → `degraded`、`enhancedQuery.available=false`、reason `worker_unreachable`；
2. 未选择模型 → `degraded`、reason `model_not_selected`；
3. 文件未下载 → reason `model_not_downloaded`；
4. 模型不匹配或未加载 → reason `model_not_loaded`；
5. 索引非 ready → reason `index_not_ready`；
6. readiness 为 not_ready → `unavailable`、reason `database_unavailable`；
7. health 调用失败 → API `unreachable` 和 overall `unavailable`；
8. lifecycle 调用失败但 API/DB 正常 → `degraded`、reason `semantic_status_unavailable`。

把抛出的错误 message 设置为包含 token、内部 URL 和堆栈文本，断言序列化结果完全不包含这些字符串。

另外记录三个 fake 方法收到的 timeout，断言全部为 `5_000`；连续调用聚合器两次，断言每个 fake 方法都被调用两次，证明没有缓存上次结果。

- [ ] **Step 3: 运行 service 测试并确认 RED**

Run:

```bash
pnpm --filter @causality/mcp exec vitest run test/systemStatusResource.test.ts
```

Expected: FAIL，系统状态 Schema 与聚合器尚不存在。

- [ ] **Step 4: 定义严格系统状态 Schema**

在 `resourceSchemas.ts` 增加 `.strict()` Schema。允许的枚举固定为：

```ts
export const systemStatusResourceSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.iso.datetime({ offset: true }),
  overallStatus: z.enum(['ready', 'degraded', 'unavailable']),
  mcp: z.object({
    status: z.literal('online'),
    name: z.literal('causality'),
    version: z.string().min(1),
  }).strict(),
  api: z.object({
    status: z.enum(['online', 'unreachable']),
    reason: z.enum(['api_unreachable']).nullable(),
  }).strict(),
  database: z.object({
    status: z.enum(['ready', 'unavailable', 'unknown']),
    reason: z.enum(['database_unavailable', 'status_unavailable']).nullable(),
  }).strict(),
  semantic: z.object({
    status: z.enum(['ready', 'degraded', 'unavailable']),
    workerStatus: z.enum(['online', 'unreachable']).nullable(),
    modelState: z.enum(['idle', 'preparing', 'loaded', 'missing', 'mismatch']).nullable(),
    currentModelCode: semanticModelCodeSchema.nullable(),
    currentModelFileState: semanticModelFileStatusSchema.nullable(),
    indexStatus: semanticIndexStatusSchema.nullable(),
  }).strict(),
  enhancedQuery: z.object({
    available: z.boolean(),
    reason: z.enum([
      'worker_unreachable',
      'model_not_selected',
      'model_not_downloaded',
      'model_not_loaded',
      'index_not_ready',
      'semantic_status_unavailable',
    ]).nullable(),
  }).strict(),
}).strict();
```

导出 `SystemStatusResource = z.infer<typeof systemStatusResourceSchema>`。

- [ ] **Step 5: 实现并行、无缓存聚合器**

`CausalityStatusApi` 精确声明三个方法。每次调用执行：

```ts
const [health, readiness, lifecycle] = await Promise.allSettled([
  api.getHealth(5_000),
  api.getReadiness(5_000),
  api.getSemanticLifecycle(5_000),
]);
```

只读取 fulfilled value，不序列化 rejected reason。先构造 API、数据库和语义分项，再按以下优先级计算 overall：API 不在线或数据库不 ready 为 `unavailable`；否则增强查询不可用为 `degraded`；全部就绪为 `ready`。最终执行 `systemStatusResourceSchema.parse(result)`。

- [ ] **Step 6: 注册第四个动态 Resource**

把 `registerStaticResources` 升级为公开 `registerResources(server, api)`，前三项保持原样，并增加：

```ts
server.registerResource(
  'causality-system-status',
  MCP_RESOURCE_URIS.systemStatus,
  {
    title: 'Causality 本地系统状态',
    description: '实时读取 API、数据库、语义 Worker、模型和索引可用状态。',
    mimeType: 'application/json',
  },
  async () => {
    const status = await buildSystemStatusResource(api, {
      now: () => new Date(),
      serverVersion: CAUSALITY_MCP_VERSION,
    });
    return {
      contents: [{
        uri: MCP_RESOURCE_URIS.systemStatus,
        mimeType: 'application/json',
        text: JSON.stringify(status, null, 2),
      }],
    };
  },
);
```

`CausalityMcpApi` 增加 `CausalityStatusApi` 交叉类型，Server 工厂只调用一次 `registerResources(server, options.apiClient)`。

- [ ] **Step 7: 更新 Resource 列表为四项并运行回归**

`resources.test.ts` 使用支持状态方法的 fake API，通过完整 Server 工厂断言 4 个固定 URI，读取系统状态并用 Schema parse。

Run:

```bash
pnpm --filter @causality/mcp exec vitest run test/systemStatusResource.test.ts test/resources.test.ts test/knowledgeTools.test.ts
pnpm --filter @causality/mcp typecheck
```

Expected: 全部 PASS，Resource 总数为 4。

- [ ] **Step 8: 提交 Task 6**

```bash
git add apps/mcp/src/resources/systemStatusResource.ts apps/mcp/src/resources/resourceSchemas.ts apps/mcp/src/resources/registerResources.ts apps/mcp/src/server/createMcpServer.ts apps/mcp/test/systemStatusResource.test.ts apps/mcp/test/resources.test.ts
git commit -m "feat: expose live MCP system status resource"
```

---

### Task 7: 补齐 HTTP、stdio 与完整能力一致性回归

**Files:**

- Modify: `apps/mcp/test/knowledgeTools.test.ts`
- Modify: `apps/mcp/test/httpTransport.test.ts`
- Modify: `apps/mcp/test/stdioTransport.test.ts`
- Modify: `apps/mcp/test/resources.test.ts`
- Modify: `apps/mcp/test/analysisPrompts.test.ts`

**Interfaces:**

- Consumes: 最终 Server 工厂、能力 manifest、四个 Prompt 和四个 Resource。
- Produces: Streamable HTTP、stdio 和 InMemory 三种测试入口的同构发布证据。

- [ ] **Step 1: 写最终 Server 能力清单失败回归**

在 `knowledgeTools.test.ts` 同时读取 tools/prompts/resources：

```ts
const [tools, prompts, resources] = await Promise.all([
  client.listTools(),
  client.listPrompts(),
  client.listResources(),
]);
expect(tools.tools.map((item) => item.name)).toEqual(MCP_CAPABILITY_MANIFEST.tools.map((item) => item.name));
expect(prompts.prompts.map((item) => item.name)).toEqual(Object.values(MCP_PROMPT_NAMES));
expect(resources.resources.map((item) => item.uri)).toEqual(Object.values(MCP_RESOURCE_URIS));
```

把 Fake API 扩展为三个系统状态方法，但保留采集方法计数器；列出和读取 Resource 后断言 `compare/prepare/commit` 均未调用。

- [ ] **Step 2: 写 stdio Prompt/Resource 读取回归**

扩展 `createApiFetch()` 返回 `/api/health`、`/api/ready`、`/api/semantic/lifecycle`。stdio 客户端连接后并行 list tools/prompts/resources，读取 `causality://system/status`，断言 15/4/4 和严格状态 JSON。状态端点请求 token 必须为 null；受保护 compare 调用仍携带当前 token。

- [ ] **Step 3: 写 Streamable HTTP Resource 会话回归**

在现有已授权 session 中依次发送 `resources/list` 和：

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "resources/read",
  "params": { "uri": "causality://system/status" }
}
```

fake fetch 返回三个状态端点。断言响应为 200、Resource JSON 通过 Schema、授权仍对每个 MCP 请求生效、状态 API 不收到 `x-causality-mcp-token`、日志中不出现 token 或响应正文。

- [ ] **Step 4: 运行测试并确认必要失败**

先在更新部分预期、尚未补齐 fake API 或 server parity 时运行：

```bash
pnpm --filter @causality/mcp exec vitest run test/knowledgeTools.test.ts test/httpTransport.test.ts test/stdioTransport.test.ts test/resources.test.ts test/analysisPrompts.test.ts
```

Expected: 新增传输断言在缺少 fixture 或上下文转发时 FAIL；不得通过删除断言规避。

- [ ] **Step 5: 完成 fixture、请求上下文和安全断言**

如果 HTTP 的 request-scoped Proxy 已能转发三个新方法，只补 fake response；如果测试暴露方法未转发，只修正 `CausalityMcpApi` 类型或 Proxy 方法绑定，不把 API client 保存在全局 session，也不把 Bearer token写入 Resource。

确认 `resources/read` 在每个授权请求的 `AsyncLocalStorage` 上下文中调用当前 `CausalityApiClient`。Resource callback 不捕获初始化请求中的旧 token。

- [ ] **Step 6: 运行 MCP 全量回归**

Run:

```bash
pnpm --filter @causality/mcp test
pnpm --filter @causality/mcp typecheck
pnpm eslint apps/mcp/src apps/mcp/test
pnpm exec prettier --check apps/mcp/src apps/mcp/test prompts skills
```

Expected: 全部 PASS，15/4/4 在三种入口一致，无敏感信息泄漏。

- [ ] **Step 7: 提交 Task 7**

```bash
git add apps/mcp/test/knowledgeTools.test.ts apps/mcp/test/httpTransport.test.ts apps/mcp/test/stdioTransport.test.ts apps/mcp/test/resources.test.ts apps/mcp/test/analysisPrompts.test.ts
git commit -m "test: cover MCP prompt and resource parity"
```

---

### Task 8: 完整验证、阶段记录与人工复核交付

**Files:**

- Modify: `docs/superpowers/specs/2026-07-30-p3-01r1-task4-readonly-query-evidence-tools-design.md`
- Modify: `docs/superpowers/specs/2026-07-30-p3-01r1-task5-analysis-prompts-resources-design.md`
- Modify: `docs/superpowers/specs/2026-07-29-p3-01r1-mcp-quality-query-optimization-design.md`
- Modify: `docs/superpowers/plans/2026-07-20-causality-application-roadmap.md`

**Interfaces:**

- Consumes: Tasks 1–7 的最终 15/4/4 能力、自动化测试与可人工调用入口。
- Produces: 状态为“实施完成，等待人工复核”的 Task 5 发布候选；Task 4 因用户已明确进入 Task 5 而记录为完成。

- [ ] **Step 1: 确认便携 Prompt 没有漂移**

Run:

```bash
pnpm --filter @causality/mcp prompt:generate
git diff --exit-code -- prompts/causality-capture.md prompts/causality-analyze-event.md prompts/causality-trace-path.md prompts/causality-review-chain.md
```

Expected: exit 0，生成文件与已提交 canonical builder 完全一致。

- [ ] **Step 2: 运行受影响工作区回归**

Run:

```bash
pnpm --filter @causality/contracts test
pnpm --filter @causality/api test
pnpm --filter @causality/mcp test
```

Expected: 全部 PASS，记录实际文件数和测试数。

- [ ] **Step 3: 运行隔离集成测试**

Run:

```bash
pnpm test:integration
```

Expected: API 与 Semantic Worker 全部 PASS，只使用当前 Docker context 的 Testcontainers 隔离数据库。

- [ ] **Step 4: 运行全仓质量门禁**

Run:

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
pnpm test:compose
git diff --check
```

Expected: 全部 exit 0；只允许既有因果图模块大分块非阻断警告。

- [ ] **Step 5: 更新阶段状态和实际验证记录**

只修改本任务列出的四份阶段文档：

- Task 4：记录用户明确进入 Task 5，人工复核门禁视为通过并标记完成；
- Task 5：状态改为“实施完成，等待人工复核”，写入实际命令和测试数量；
- P3-01R1 阶段：Task 1–4 已完成，Task 5 等待人工复核，阶段仍未完成；
- roadmap：同步相同状态和实际验证结果。

不得修改当前用户拥有的 README、Task 2 设计工作树改动、`docs/user-guide.md` 或 `research/`。

- [ ] **Step 6: 准备人工复核清单**

向用户交付但不代替执行：

1. 当前会话单一事件的直接原因/结果分析；
2. 事件歧义时要求选择；
3. 最多 5 条关系和每条最多 3 个案例；
4. 主要路径完整证据与两条候选摘要；
5. 无路径和截断的有限定措辞；
6. 因果链五类逐段结果；
7. 不生成平均置信度、整体概率或真假评分；
8. 外部信息与数据库事实分区；
9. 四个 Resource 与局部失败系统状态；
10. Markdown/Skill fallback；
11. 全过程无方案、无提交、无业务数据变化。

- [ ] **Step 7: 提交 Task 8 发布候选**

```bash
git add docs/superpowers/specs/2026-07-30-p3-01r1-task4-readonly-query-evidence-tools-design.md docs/superpowers/specs/2026-07-30-p3-01r1-task5-analysis-prompts-resources-design.md docs/superpowers/specs/2026-07-29-p3-01r1-mcp-quality-query-optimization-design.md docs/superpowers/plans/2026-07-20-causality-application-roadmap.md
git commit -m "docs: prepare Task 5 analysis review"
```

提交后停在人工复核门禁，不推送 GitHub，不自动进入 P3-02。

## Plan Self-Review Checklist

- [x] 三个 Prompt 分别有独立 builder、注册、便携文件和 Skill。
- [x] Prompt 无参数、从当前可见会话识别目标，歧义时询问，无匹配时停止。
- [x] 工具白名单十项和采集工具拒绝列表五项均有 manifest 与 Prompt 回归。
- [x] 事件分析覆盖直接关系、100/5/3 限制、排序、未展开数量和逐层追问。
- [x] 路径覆盖默认深度、路径上限、主要路径证据、其他摘要和截断措辞。
- [x] 链审查覆盖十段上限、五类状态、间接路径改写和反向风险。
- [x] 输出覆盖置信度边界、无案例、外部信息分区和不显示内部 JSON/UUID。
- [x] 四个固定 Resource 均有 MIME、严格内容、读取和传输回归。
- [x] 系统状态覆盖 5 秒超时、并行检查、ready/degraded/unavailable、原因码和脱敏。
- [x] 现有 15 个工具、采集 Prompt、HTTP/stdio 认证和请求级 token 绑定保持兼容。
- [x] 没有数据库迁移、Web、在线 AI、联网抓取、通用写权限或 P3-02 扩展。
- [x] 最终状态停在 Task 5 人工复核门禁，不推送、不提前完成 P3-01R1。
