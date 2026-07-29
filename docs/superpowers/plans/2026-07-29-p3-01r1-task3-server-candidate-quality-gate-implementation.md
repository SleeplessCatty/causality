# P3-01R1 Task 3 服务端候选质量门禁 Implementation Plan

状态：实施完成，等待人工复核

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 AI 候选对比和入库方案生成增加版本化、可修复、可向后兼容的服务端质量门禁，使阻断问题在查询或写方案前停止，存疑问题和主题相关性信号能够完整返回给外部 AI。

**Architecture:** 共享契约定义唯一的质量报告结构；API 内新增纯规则 `AiCaptureQualityGate` 深模块，候选对比服务负责前置检查和对比期合并，方案服务在读取当前数据库状态后重新计算报告并覆盖客户端值。MCP 只镜像服务端结构并生成可读摘要，不自行修改质量结论；现有不可变方案、用户确认、幂等提交和事务边界保持不变。

**Tech Stack:** TypeScript 5.9、Node.js 24、Zod 4、Fastify 5、PostgreSQL 18、pgvector、MCP TypeScript SDK、Vitest、pnpm workspace。

## Global Constraints

- 一次最多处理 50 条原子事件；具体案例、因果关系和案例关联不增加业务条数上限。
- 阻断问题必须停止昂贵查询或方案创建；存疑问题只提示，不自动删除候选。
- 主题相关性只返回同批次内的相对语义信号，不设置跨模型统一阈值，也不用于证明因果关系。
- 服务端不得信任客户端回传的 `qualityReport`；新方案只保存服务端本次重新计算的报告。
- 旧对比结果和旧方案缺少 `qualityReport` 时按空的 V1 报告读取，不增加数据库迁移。
- 保持现有 11 个 MCP 工具和 `causality_capture` Prompt，不增加通用写、SQL、网页抓取或来源保存能力。
- 不修改 Web、AI 导入历史页面、正式业务表、提交事务、置信度计算和成功标记逻辑。
- 本阶段只创建本地任务提交，不推送 GitHub；完整阶段验收通过后再统一推送。
- 保留用户已有的 `.gitignore`、`README.md`、`docs/user-guide.md` 和 `research/` 修改，不纳入本任务提交。

---

## File map

### 新建

- `packages/contracts/src/ai-capture/aiCaptureQualitySchemas.ts`：质量状态、阶段、问题代码、问题、主题信号、报告和空报告共享契约。
- `apps/api/src/features/ai-capture/aiCaptureQualityGate.ts`：候选、对比和方案阶段的纯确定性规则、稳定排序、报告合并及 Zod 路径转换。
- `apps/api/test/ai-capture-quality-gate.test.ts`：全部阻断规则、存疑规则、排序和方案决策规则的表驱动单元测试。

### 修改

- `packages/contracts/src/ai-capture/aiCaptureSchemas.ts`：在对比结果和工作流错误中接入质量报告，并为旧数据提供默认值。
- `packages/contracts/src/index.ts`：导出质量契约。
- `packages/contracts/test/ai-capture.test.ts`：严格 Schema、默认值和旧数据兼容测试。
- `apps/api/src/features/ai-capture/aiCandidateComparisonService.ts`：数据库查询前门禁、主题信号、对比期报告和重复分组清理。
- `apps/api/src/features/ai-capture/aiSemanticCandidateService.ts`：同模型主题—事件余弦相似度信号。
- `apps/api/src/features/ai-capture/aiImportPlanService.ts`：读取当前状态后重新计算报告并覆盖客户端报告。
- `apps/api/src/features/ai-capture/aiImportPlanValidator.ts`：将既有方案校验失败保留为可映射的稳定错误代码和相关 ref。
- `apps/api/src/features/ai-capture/aiCaptureErrors.ts`：质量阻断错误和质量报告载荷。
- `apps/api/src/features/ai-capture/aiCaptureRoutes.ts`：依赖装配、结构化 Fastify 校验错误和工作流错误响应。
- `apps/api/test/ai-candidate-comparison-service.test.ts`：前置阻断和对比报告单元测试。
- `apps/api/test/ai-candidate-comparison.integration.test.ts`：真实 PostgreSQL 对比报告集成测试。
- `apps/api/test/ai-import-plan-service.test.ts`：方案阶段重新计算和不信任客户端报告测试。
- `apps/api/test/ai-import-plan.integration.test.ts`：不写计划表、旧报告兼容和警告放行集成测试。
- `apps/api/test/ai-capture-routes.test.ts`：JSON Pointer、状态码和质量错误序列化测试。
- `apps/api/test/ai-capture-routes.integration.test.ts`：HTTP 端到端质量报告测试。
- `apps/api/test/ai-semantic-candidate-service.test.ts`：主题相关性向量和异常向量测试。
- `apps/mcp/src/tools/captureMcpSchemas.ts`：质量报告传输镜像。
- `apps/mcp/src/api/causalityApiClient.ts`：保留 API 错误中的质量报告。
- `apps/mcp/src/tools/registerCaptureTools.ts`：对比、方案和失败结果的可读质量摘要。
- `apps/mcp/src/prompts/capturePrompt.ts`：服务端质量报告自动修复循环。
- `apps/mcp/test/causalityApiClient.test.ts`：质量报告错误透传测试。
- `apps/mcp/test/captureTools.test.ts`：工具结构化内容和文本摘要测试。
- `apps/mcp/test/capturePrompt.test.ts`：V2 Prompt 自动修复规则测试。
- `prompts/causality-capture.md`：由生成器同步的便携 Prompt。
- `docs/superpowers/specs/2026-07-29-p3-01r1-task3-server-candidate-quality-gate-design.md`：实施与验收状态。
- `docs/superpowers/specs/2026-07-29-p3-01r1-mcp-quality-query-optimization-design.md`：阶段 Task 状态。
- `docs/superpowers/plans/2026-07-20-causality-application-roadmap.md`：总体路线状态。

---

### Task 1: 共享质量契约与旧数据兼容

**Files:**

- Create: `packages/contracts/src/ai-capture/aiCaptureQualitySchemas.ts`
- Modify: `packages/contracts/src/ai-capture/aiCaptureSchemas.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/test/ai-capture.test.ts`

**Interfaces:**

- Consumes: 现有 `aiCaptureComparisonSchema`、`aiWorkflowErrorSchema` 和 `aiImportPlanSchema`。
- Produces: `AiCaptureQualityReport`、`AiCaptureQualityIssue`、`AiCaptureTopicRelevanceSignal`、`EMPTY_AI_CAPTURE_QUALITY_REPORT`、`aiCaptureQualityReportSchema`。

- [ ] **Step 1: 为严格 Schema、稳定默认值和向后兼容写失败测试**

```ts
it('defaults a missing comparison quality report to an empty V1 report', () => {
  expect(aiCaptureComparisonSchema.parse(comparisonWithoutQuality).qualityReport).toEqual({
    version: 1,
    status: 'passed',
    issues: [],
    topicRelevance: [],
  });
});

it('accepts an optional workflow quality report and rejects unknown fields', () => {
  expect(aiWorkflowErrorSchema.parse({ ...workflowError, qualityReport }).qualityReport).toEqual(
    qualityReport,
  );
  expect(aiCaptureQualityReportSchema.safeParse({ ...qualityReport, extra: true }).success).toBe(
    false,
  );
});
```

- [ ] **Step 2: 运行 contracts 测试并确认缺少导出或字段导致失败**

Run: `pnpm --filter @causality/contracts test -- ai-capture.test.ts`

Expected: FAIL，提示 `aiCaptureQualityReportSchema` 不存在或 `qualityReport` 未返回。

- [ ] **Step 3: 新增完整的问题代码和质量报告 Schema**

```ts
export const aiCaptureQualityIssueCodeSchema = z.enum([
  'AI_QUALITY_SCHEMA_INVALID',
  'AI_QUALITY_EVENT_LIMIT_EXCEEDED',
  'AI_QUALITY_DUPLICATE_REF',
  'AI_QUALITY_REFERENCE_MISSING',
  'AI_QUALITY_SELF_LOOP',
  'AI_QUALITY_DUPLICATE_LINK',
  'AI_QUALITY_DUPLICATE_EVENT_NAME',
  'AI_QUALITY_DUPLICATE_CASE_CONTENT',
  'AI_QUALITY_DUPLICATE_RELATION',
  'AI_QUALITY_ORPHAN_EVENT',
  'AI_QUALITY_ORPHAN_CASE',
  'AI_QUALITY_COMPOUND_EVENT_SUSPECTED',
  'AI_QUALITY_ALIAS_COLLISION',
  'AI_QUALITY_RELATION_WITHOUT_CASE',
  'AI_QUALITY_TRANSITIVE_SHORTCUT_SUSPECTED',
  'AI_QUALITY_EVENTS_SHARE_EXACT_MATCH',
  'AI_QUALITY_CASES_SHARE_EXACT_MATCH',
  'AI_QUALITY_EVENT_SEMANTIC_DUPLICATE_SUSPECTED',
  'AI_QUALITY_CASE_SEMANTIC_DUPLICATE_SUSPECTED',
  'AI_QUALITY_ACTIVE_EVENT_ORPHANED',
  'AI_QUALITY_ACTIVE_CASE_ORPHANED',
  'AI_QUALITY_DECISION_DEPENDENCY_INVALID',
  'AI_QUALITY_COMPARISON_COVERAGE_INVALID',
  'AI_QUALITY_DECISION_COVERAGE_INVALID',
  'AI_QUALITY_REUSE_TARGET_INVALID',
  'AI_QUALITY_CREATE_EXACT_CONFLICT',
  'AI_QUALITY_COMPARISON_STALE',
  'AI_QUALITY_BATCH_UNIQUE_CONFLICT',
  'AI_QUALITY_REPORT_BLOCKED',
]);

export const aiCaptureQualityReportSchema = z
  .object({
    version: z.literal(1),
    status: z.enum(['passed', 'warning', 'blocked']),
    issues: z.array(aiCaptureQualityIssueSchema),
    topicRelevance: z.array(aiCaptureTopicRelevanceSignalSchema),
  })
  .strict();

export const EMPTY_AI_CAPTURE_QUALITY_REPORT = {
  version: 1,
  status: 'passed',
  issues: [],
  topicRelevance: [],
} as const satisfies AiCaptureQualityReport;
```

`paths` 使用 `z.string().startsWith('/')`；`similarity` 限制在 `0..1`；所有对象使用 `.strict()`。

- [ ] **Step 4: 把报告接入对比结果、工作流错误和顶层导出**

```ts
export const aiCaptureComparisonSchema = z
  .object({
    atomicEvents: z.array(eventComparisonSchema),
    concreteCases: z.array(caseComparisonSchema),
    causalRelations: z.array(relationComparisonSchema),
    relationCaseLinks: z.array(linkComparisonSchema),
    qualityReport: aiCaptureQualityReportSchema.default(EMPTY_AI_CAPTURE_QUALITY_REPORT),
  })
  .strict();

export const aiWorkflowErrorSchema = z
  .object({
    category: z.enum(['data', 'system', 'configuration']),
    code: z.string().min(1),
    message: z.string().min(1),
    affectedRefs: z.array(z.string()).default([]),
    aiCanRepair: z.boolean(),
    retryCurrentPlan: z.boolean(),
    suggestedAction: z.string().min(1),
    qualityReport: aiCaptureQualityReportSchema.optional(),
  })
  .strict();
```

顶层 `packages/contracts/src/index.ts` 同时导出 Schema、常量和全部质量类型。

- [ ] **Step 5: 在现有跨字段 Zod issue 中加入机器可读质量元数据**

```ts
context.addIssue({
  code: 'custom',
  message: '因果关系不能形成自环',
  path: ['causalRelations', index, 'effectEventRef'],
  params: {
    qualityCode: 'AI_QUALITY_SELF_LOOP',
    entityType: 'relation',
  },
});
```

为重复 ref、缺失引用、自环和重复关联加入 `qualityCode`；原有中文错误消息和 Schema 行为保持不变。

- [ ] **Step 6: 运行 contracts 测试、类型检查和格式检查**

Run:

```bash
pnpm --filter @causality/contracts test -- ai-capture.test.ts
pnpm --filter @causality/contracts typecheck
pnpm exec prettier --check packages/contracts/src/ai-capture packages/contracts/src/index.ts packages/contracts/test/ai-capture.test.ts
```

Expected: 全部 PASS。

- [ ] **Step 7: 创建本地契约提交**

```bash
git add packages/contracts/src/ai-capture/aiCaptureQualitySchemas.ts packages/contracts/src/ai-capture/aiCaptureSchemas.ts packages/contracts/src/index.ts packages/contracts/test/ai-capture.test.ts
git commit -m "feat: add AI capture quality contracts"
```

---

### Task 2: 候选阶段纯规则质量门禁

**Files:**

- Create: `apps/api/src/features/ai-capture/aiCaptureQualityGate.ts`
- Create: `apps/api/test/ai-capture-quality-gate.test.ts`

**Interfaces:**

- Consumes: `AiCaptureCandidateSet`、`AiCaptureQualityIssue`、`AiCaptureQualityReport` 和 Zod issue 的 `params.qualityCode`。
- Produces: `AiCaptureQualityGate.inspectCandidates(input)`、`qualityReportFromZodError(raw, error)`、`mergeQualityReports(...reports)`。

- [ ] **Step 1: 为报告状态、稳定排序和全部候选规则写表驱动失败测试**

```ts
it.each([
  ['duplicate event name', duplicateEventNameInput, 'AI_QUALITY_DUPLICATE_EVENT_NAME'],
  ['duplicate case content', duplicateCaseInput, 'AI_QUALITY_DUPLICATE_CASE_CONTENT'],
  ['duplicate relation', duplicateRelationInput, 'AI_QUALITY_DUPLICATE_RELATION'],
  ['orphan event', orphanEventInput, 'AI_QUALITY_ORPHAN_EVENT'],
  ['orphan case', orphanCaseInput, 'AI_QUALITY_ORPHAN_CASE'],
])('%s is blocking', (_name, input, code) => {
  const report = gate.inspectCandidates(input);
  expect(report.status).toBe('blocked');
  expect(report.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
});

it.each([
  ['compound event', compoundEventInput, 'AI_QUALITY_COMPOUND_EVENT_SUSPECTED'],
  ['alias collision', aliasCollisionInput, 'AI_QUALITY_ALIAS_COLLISION'],
  ['relation without case', relationWithoutCaseInput, 'AI_QUALITY_RELATION_WITHOUT_CASE'],
  ['transitive shortcut', transitiveInput, 'AI_QUALITY_TRANSITIVE_SHORTCUT_SUSPECTED'],
])('%s is warning only', (_name, input, code) => {
  const report = gate.inspectCandidates(input);
  expect(report.status).toBe('warning');
  expect(report.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
});
```

- [ ] **Step 2: 运行质量门禁单测并确认模块不存在**

Run: `pnpm --filter @causality/api test -- ai-capture-quality-gate.test.ts`

Expected: FAIL，提示无法导入 `aiCaptureQualityGate.js`。

- [ ] **Step 3: 实现统一问题构造、状态派生和稳定排序**

```ts
const severityRank = { error: 0, warning: 1 } as const;

function issueOrder(left: AiCaptureQualityIssue, right: AiCaptureQualityIssue): number {
  return (
    severityRank[left.severity] - severityRank[right.severity] ||
    left.code.localeCompare(right.code) ||
    (left.paths[0] ?? '').localeCompare(right.paths[0] ?? '') ||
    (left.refs[0] ?? '').localeCompare(right.refs[0] ?? '')
  );
}

export function buildQualityReport(
  issues: readonly AiCaptureQualityIssue[],
  topicRelevance: readonly AiCaptureTopicRelevanceSignal[] = [],
): AiCaptureQualityReport {
  const sorted = [...issues].sort(issueOrder);
  return {
    version: 1,
    status: sorted.some((issue) => issue.severity === 'error')
      ? 'blocked'
      : sorted.length > 0
        ? 'warning'
        : 'passed',
    issues: sorted,
    topicRelevance: [...topicRelevance].sort((a, b) => a.ref.localeCompare(b.ref)),
  };
}
```

- [ ] **Step 4: 实现确定性阻断规则**

标准化事件名使用 `trim().toLocaleLowerCase('zh-CN')`，案例内容使用 `trim()`，关系唯一键使用 `causeEventRef + \u0000 + effectEventRef`。事件和案例的入度/出度集合分别从关系端点和案例关联生成；没有进入集合的候选产生孤立问题。每个 issue 必须包含准确的候选 `ref` 和 JSON Pointer，例如 `/atomicEvents/2/name`。

```ts
export class AiCaptureQualityGate {
  public inspectCandidates(input: AiCaptureCandidateSet): AiCaptureQualityReport {
    return buildQualityReport([
      ...duplicateEventNameIssues(input),
      ...duplicateCaseContentIssues(input),
      ...duplicateRelationIssues(input),
      ...orphanEventIssues(input),
      ...orphanCaseIssues(input),
      ...candidateWarningIssues(input),
    ]);
  }
}
```

- [ ] **Step 5: 实现保守的存疑规则**

复合事件只在名称或非空描述同时包含连接结构 `并且|同时|以及|并`，并能识别出至少两个独立变化短语时产生 warning；名称命中时指向名称，否则指向描述，它不得产生 error。别名冲突按标准化后的“事件名 + 全部别名”比较。无案例关系和 `A→B`、`B→C`、`A→C` 只产生 warning，并保持原候选不变。

- [ ] **Step 6: 实现 Zod issue 到质量报告的字段级转换**

```ts
export function qualityReportFromZodError(raw: unknown, error: z.ZodError): AiCaptureQualityReport {
  return buildQualityReport(
    error.issues.map((issue) => ({
      code: qualityCodeFromIssue(issue),
      severity: 'error',
      phase: 'candidate',
      entityType: entityTypeFromPath(issue.path),
      refs: refsFromPath(raw, issue.path),
      paths: [toJsonPointer(issue.path)],
      message: issue.message,
      suggestedAction: suggestionForCode(qualityCodeFromIssue(issue)),
      aiCanRepair: true,
    })),
  );
}
```

JSON Pointer 必须转义 `~` 为 `~0`、`/` 为 `~1`；事件超过 50 条映射到 `AI_QUALITY_EVENT_LIMIT_EXCEEDED`，其余未标记的基础字段错误映射到 `AI_QUALITY_SCHEMA_INVALID`。

- [ ] **Step 7: 运行表驱动测试并检查分支覆盖**

Run:

```bash
pnpm --filter @causality/api test -- ai-capture-quality-gate.test.ts
pnpm --filter @causality/api typecheck
```

Expected: 全部 PASS；同一输入重复运行得到完全相同的问题顺序。

- [ ] **Step 8: 创建本地候选规则提交**

```bash
git add apps/api/src/features/ai-capture/aiCaptureQualityGate.ts apps/api/test/ai-capture-quality-gate.test.ts
git commit -m "feat: validate AI capture candidate quality"
```

---

### Task 3: 候选对比前置门禁与早停

**Files:**

- Modify: `apps/api/src/features/ai-capture/aiCandidateComparisonService.ts`
- Modify: `apps/api/src/features/ai-capture/aiCaptureErrors.ts`
- Modify: `apps/api/src/features/ai-capture/aiCaptureRoutes.ts`
- Test: `apps/api/test/ai-candidate-comparison-service.test.ts`

**Interfaces:**

- Consumes: `AiCaptureQualityGate.inspectCandidates()` 和 `qualityReportFromZodError()`。
- Produces: `AiCaptureQualityBlockedError`，以及保证阻断输入不调用 Repository/语义服务的 `compare(rawInput: unknown)`。

- [ ] **Step 1: 写前置阻断早停失败测试**

```ts
it('does not query PostgreSQL or the semantic worker when candidate quality is blocked', async () => {
  await expect(service.compare(duplicateEventNameInput)).rejects.toMatchObject({
    code: 'AI_CANDIDATE_QUALITY_BLOCKED',
    qualityReport: expect.objectContaining({ status: 'blocked' }),
  });
  expect(repository.findEventMatches).not.toHaveBeenCalled();
  expect(repository.findCaseMatches).not.toHaveBeenCalled();
  expect(semantic.compare).not.toHaveBeenCalled();
});
```

同时覆盖字段长度错误、缺失引用、自环、重复 ref、重复关联、事件上限和孤立候选。

- [ ] **Step 2: 运行候选对比服务测试并确认当前仍执行依赖或返回旧错误**

Run: `pnpm --filter @causality/api test -- ai-candidate-comparison-service.test.ts`

Expected: FAIL，当前错误没有 `qualityReport` 或依赖被调用。

- [ ] **Step 3: 新增携带报告的专用阻断错误**

```ts
export class AiCaptureQualityBlockedError extends AiCaptureDataError {
  public constructor(
    code: 'AI_CANDIDATE_QUALITY_BLOCKED' | 'AI_PLAN_QUALITY_BLOCKED',
    public readonly qualityReport: AiCaptureQualityReport,
  ) {
    super(
      code,
      [...new Set(qualityReport.issues.flatMap((issue) => issue.refs))],
      code === 'AI_CANDIDATE_QUALITY_BLOCKED'
        ? '候选集合存在必须修复的质量问题'
        : '入库方案存在必须修复的质量问题',
    );
  }
}
```

把两个新错误代码加入 `AiCaptureErrorCode` 和 HTTP 400 映射。

- [ ] **Step 4: 在任何外部查询前解析并执行门禁**

```ts
public async compare(rawInput: unknown): Promise<AiCaptureComparison> {
  const parsed = aiCaptureCandidateSetInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new AiCaptureQualityBlockedError(
      'AI_CANDIDATE_QUALITY_BLOCKED',
      qualityReportFromZodError(rawInput, parsed.error),
    );
  }
  const candidateReport = this.qualityGate.inspectCandidates(parsed.data);
  if (candidateReport.status === 'blocked') {
    throw new AiCaptureQualityBlockedError('AI_CANDIDATE_QUALITY_BLOCKED', candidateReport);
  }
  // Existing PostgreSQL and semantic comparison follows only here.
}
```

- [ ] **Step 5: 删除已被门禁取代的重复分组路径**

批次内同名事件和同内容案例已经阻断，不再合并多个 ref 后查询。删除 `Group`、`groupEvents()`、`groupCases()` 及复制匹配结果逻辑，改为按输入数组一一查询和映射；保留普通/语义结果合并、排序、精确身份、关系探测和关联探测逻辑。

- [ ] **Step 6: 运行服务测试和 API 类型检查**

Run:

```bash
pnpm --filter @causality/api test -- ai-candidate-comparison-service.test.ts ai-capture-quality-gate.test.ts
pnpm --filter @causality/api typecheck
```

Expected: 全部 PASS；warning 输入仍会执行查询。

- [ ] **Step 7: 创建本地前置门禁提交**

```bash
git add apps/api/src/features/ai-capture/aiCandidateComparisonService.ts apps/api/src/features/ai-capture/aiCaptureErrors.ts apps/api/src/features/ai-capture/aiCaptureRoutes.ts apps/api/test/ai-candidate-comparison-service.test.ts
git commit -m "feat: stop invalid AI candidates before comparison"
```

---

### Task 4: 主题相关性信号与对比阶段报告

**Files:**

- Modify: `apps/api/src/features/ai-capture/aiSemanticCandidateService.ts`
- Modify: `apps/api/src/features/ai-capture/aiCaptureQualityGate.ts`
- Modify: `apps/api/src/features/ai-capture/aiCandidateComparisonService.ts`
- Test: `apps/api/test/ai-semantic-candidate-service.test.ts`
- Test: `apps/api/test/ai-capture-quality-gate.test.ts`
- Test: `apps/api/test/ai-candidate-comparison-service.test.ts`
- Test: `apps/api/test/ai-candidate-comparison.integration.test.ts`

**Interfaces:**

- Consumes: 已通过候选门禁的候选集合和完整 `AiCaptureComparison`。
- Produces: `AiSemanticCandidateService.topicRelevance(topic, events)`、`AiCaptureQualityGate.inspectComparison(input)`，以及新服务端始终返回的 `comparison.qualityReport`。

- [ ] **Step 1: 写主题向量和对比期问题失败测试**

```ts
it('scores topic relevance with one topic vector and one vector per event', async () => {
  workerClient.embedQueries.mockResolvedValue([
    [1, 0],
    [1, 0],
    [0, 1],
  ]);
  await expect(
    service.topicRelevance('利率传导', [
      { ref: 'event-001', name: '政策利率上升' },
      { ref: 'event-002', name: '汽车销量下降' },
    ]),
  ).resolves.toEqual([
    { ref: 'event-001', similarity: 1 },
    { ref: 'event-002', similarity: 0 },
  ]);
});

it('warns when two candidates share the same unique exact match', () => {
  expect(gate.inspectComparison(input).issues).toContainEqual(
    expect.objectContaining({ code: 'AI_QUALITY_EVENTS_SHARE_EXACT_MATCH' }),
  );
});
```

- [ ] **Step 2: 运行三个单元测试文件并确认缺少方法**

Run:

```bash
pnpm --filter @causality/api test -- ai-semantic-candidate-service.test.ts ai-capture-quality-gate.test.ts ai-candidate-comparison-service.test.ts
```

Expected: FAIL，提示 `topicRelevance` 或 `inspectComparison` 不存在。

- [ ] **Step 3: 实现主题—事件同模型余弦相似度**

```ts
public async topicRelevance(
  topic: string,
  events: readonly { ref: string; name: string }[],
): Promise<AiCaptureTopicRelevanceSignal[]> {
  if (events.length === 0) return [];
  const context = await this.options.contextRepository.activeContext();
  this.assertReady(context);
  const vectors = await this.options.workerClient.embedQueries(
    context.modelCode,
    [topic, ...events.map((event) => event.name)],
  );
  this.assertVectors(vectors, events.length + 1, MODEL_CATALOG[context.modelCode].dimensions);
  const topicVector = vectors[0]!;
  return events.map((event, index) => ({
    ref: event.ref,
    similarity: clampCosine(cosineSimilarity(topicVector, vectors[index + 1]!)),
  }));
}
```

零范数、维度错误和非有限值统一转为现有 `SEMANTIC_WORKER_UNAVAILABLE`；不把主题信号写入 pgvector 表。

- [ ] **Step 4: 实现对比阶段精确共享和语义重复警告**

精确共享要求多个候选的唯一精确匹配指向同一个数据库 ID。语义重复仅在多个候选的首个匹配均为 `semantic`、指向同一 ID 且 `similarity >= 0.90` 时产生保守 warning；该阈值只用于“疑似重复”提示，不用于主题相关性、自动复用或因果判断。

```ts
public inspectComparison(input: {
  candidates: AiCaptureCandidateSet;
  comparison: AiCaptureComparison;
  topicRelevance: AiCaptureTopicRelevanceSignal[];
}): AiCaptureQualityReport {
  return buildQualityReport(
    [
      ...this.inspectCandidates(input.candidates).issues,
      ...sharedExactMatchIssues(input.comparison),
      ...sharedSemanticMatchIssues(input.comparison),
    ],
    input.topicRelevance,
  );
}
```

- [ ] **Step 5: 在候选对比服务中合并报告**

普通匹配、案例匹配、事件语义匹配、案例语义匹配和主题相关性可并行执行。构造不含报告的对比主体后调用 `inspectComparison()`，最终返回：

```ts
return {
  ...comparison,
  qualityReport: this.qualityGate.inspectComparison({
    candidates: input,
    comparison,
    topicRelevance,
  }),
};
```

- [ ] **Step 6: 运行单元和 PostgreSQL 集成测试**

Run:

```bash
pnpm --filter @causality/api test -- ai-semantic-candidate-service.test.ts ai-capture-quality-gate.test.ts ai-candidate-comparison-service.test.ts
pnpm --filter @causality/api test:integration -- ai-candidate-comparison.integration.test.ts
```

Expected: 全部 PASS；无问题返回 `passed`，warning 保留查询结果，主题分数不影响状态。

- [ ] **Step 7: 创建本地对比报告提交**

```bash
git add apps/api/src/features/ai-capture/aiSemanticCandidateService.ts apps/api/src/features/ai-capture/aiCaptureQualityGate.ts apps/api/src/features/ai-capture/aiCandidateComparisonService.ts apps/api/test/ai-semantic-candidate-service.test.ts apps/api/test/ai-capture-quality-gate.test.ts apps/api/test/ai-candidate-comparison-service.test.ts apps/api/test/ai-candidate-comparison.integration.test.ts
git commit -m "feat: report AI candidate comparison quality"
```

---

### Task 5: 方案阶段重新计算、覆盖与阻断

**Files:**

- Modify: `apps/api/src/features/ai-capture/aiCaptureQualityGate.ts`
- Modify: `apps/api/src/features/ai-capture/aiImportPlanService.ts`
- Modify: `apps/api/src/features/ai-capture/aiImportPlanValidator.ts`
- Modify: `apps/api/src/features/ai-capture/aiCaptureRoutes.ts`
- Test: `apps/api/test/ai-capture-quality-gate.test.ts`
- Test: `apps/api/test/ai-import-plan-service.test.ts`
- Test: `apps/api/test/ai-import-plan.integration.test.ts`

**Interfaces:**

- Consumes: `PrepareAiImportPlanInput`、当前数据库 preparation state 和 `AiSemanticCandidateService.topicRelevance()`。
- Produces: `AiCaptureQualityGate.inspectPlan(input)`、`qualityReportForPlanValidationError(error, input)`，以及只保存服务端报告的 `AiImportPlanService.prepare()`。

- [ ] **Step 1: 写方案依赖和不信任客户端报告失败测试**

```ts
it('recomputes and replaces a forged client quality report', async () => {
  const input = validPlanInput({
    comparisonQualityReport: {
      version: 1,
      status: 'passed',
      issues: [],
      topicRelevance: [{ ref: 'event-001', similarity: 1 }],
    },
  });
  semantic.topicRelevance.mockResolvedValue([{ ref: 'event-001', similarity: 0.4 }]);
  await service.prepare(input);
  expect(repository.createPlan).toHaveBeenCalledWith(
    expect.objectContaining({
      comparison: expect.objectContaining({
        qualityReport: expect.objectContaining({
          topicRelevance: [{ ref: 'event-001', similarity: 0.4 }],
        }),
      }),
    }),
    expect.anything(),
  );
});

it('does not create a plan when an active event becomes orphaned', async () => {
  await expect(service.prepare(activeOrphanPlanInput)).rejects.toMatchObject({
    code: 'AI_PLAN_QUALITY_BLOCKED',
  });
  expect(repository.createPlan).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: 运行方案单测并确认客户端报告仍会原样保存**

Run: `pnpm --filter @causality/api test -- ai-import-plan-service.test.ts ai-capture-quality-gate.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现决策感知的方案规则**

`inspectPlan(input)` 先重新运行候选规则和对比期重复规则，再按 `action !== 'skip'` 计算有效事件、案例、关系和关联。覆盖：有效事件孤立、有效案例孤立、有效关系依赖 skip 事件、有效关联依赖 skip 关系或案例、候选报告仍 blocked。所有问题阶段为 `plan`，路径指向 `/decisions/...`。

- [ ] **Step 4: 把既有方案校验错误映射为结构化问题**

```ts
const planValidationCodeMap: Record<AiCaptureErrorCode, AiCaptureQualityIssueCode> = {
  AI_PLAN_INPUT_INVALID: 'AI_QUALITY_COMPARISON_COVERAGE_INVALID',
  AI_PLAN_DECISIONS_INVALID: 'AI_QUALITY_DECISION_COVERAGE_INVALID',
  AI_PLAN_REUSE_INVALID: 'AI_QUALITY_REUSE_TARGET_INVALID',
  AI_PLAN_DEPENDENCY_SKIPPED: 'AI_QUALITY_DECISION_DEPENDENCY_INVALID',
  AI_PLAN_UNIQUE_CONFLICT: 'AI_QUALITY_BATCH_UNIQUE_CONFLICT',
  AI_PLAN_COMPARISON_STALE: 'AI_QUALITY_COMPARISON_STALE',
};
```

`qualityReportForPlanValidationError()` 使用 `affectedRefs` 定位候选和决策路径；无法定位单项时使用批次路径 `/decisions`，不得返回空 `paths`。

- [ ] **Step 5: 按“解析—读取状态—重算—校验—创建”重排方案服务**

```ts
public async prepare(input: unknown): Promise<AiImportPlan> {
  const parsed = parseAiImportPlanInput(input);
  const state = await this.repository.loadPreparationState(parsed);
  const topicRelevance = await this.semantic.topicRelevance(
    parsed.candidates.topic,
    parsed.candidates.atomicEvents,
  );
  const planReport = this.qualityGate.inspectPlan(parsed);
  const report = buildQualityReport(planReport.issues, topicRelevance);
  if (report.status === 'blocked') {
    throw new AiCaptureQualityBlockedError('AI_PLAN_QUALITY_BLOCKED', report);
  }
  const trustedInput = {
    ...parsed,
    comparison: { ...parsed.comparison, qualityReport: report },
  };
  try {
    const mutations = prepareAiImportMutations(trustedInput, state);
    return this.repository.createPlan(trustedInput, mutations);
  } catch (error) {
    throw mapPlanValidationToQualityError(error, trustedInput, report);
  }
}
```

`inspectPlan(input)` 保持设计文档中的单参数接口；主题信号由方案服务重新计算后通过 `buildQualityReport(planReport.issues, topicRelevance)` 合并，不能读取客户端报告中的信号。`createAiCaptureRouteDependencies()` 将同一个语义服务实例和质量门禁实例注入对比服务与方案服务。

- [ ] **Step 6: 覆盖旧对比、warning 放行和计划表不写入集成测试**

集成断言：缺少 `qualityReport` 的旧输入可生成方案；warning 输入可生成方案并保存 warning；blocked 输入和既有校验失败都不产生 `ai_import_plans` 新行；伪造的客户端状态、问题和主题分数均不进入保存结果。

- [ ] **Step 7: 运行方案单元与集成测试**

Run:

```bash
pnpm --filter @causality/api test -- ai-import-plan-service.test.ts ai-capture-quality-gate.test.ts
pnpm --filter @causality/api test:integration -- ai-import-plan.integration.test.ts
pnpm --filter @causality/api typecheck
```

Expected: 全部 PASS。

- [ ] **Step 8: 创建本地方案门禁提交**

```bash
git add apps/api/src/features/ai-capture/aiCaptureQualityGate.ts apps/api/src/features/ai-capture/aiImportPlanService.ts apps/api/src/features/ai-capture/aiImportPlanValidator.ts apps/api/src/features/ai-capture/aiCaptureRoutes.ts apps/api/test/ai-capture-quality-gate.test.ts apps/api/test/ai-import-plan-service.test.ts apps/api/test/ai-import-plan.integration.test.ts
git commit -m "feat: enforce AI import plan quality"
```

---

### Task 6: HTTP 校验路径与工作流错误响应

**Files:**

- Modify: `apps/api/src/features/ai-capture/aiCaptureRoutes.ts`
- Modify: `apps/api/src/features/ai-capture/aiWorkflowErrorClassifier.ts`
- Test: `apps/api/test/ai-capture-routes.test.ts`
- Test: `apps/api/test/ai-capture-routes.integration.test.ts`

**Interfaces:**

- Consumes: Fastify/Zod validation details和 `AiCaptureQualityBlockedError`。
- Produces: 带 `qualityReport` 的 HTTP 400 `AiWorkflowError`，以及保持现有系统/配置错误结构的响应。

- [ ] **Step 1: 写字段路径和错误载荷失败测试**

```ts
expect(response.statusCode).toBe(400);
expect(response.json()).toMatchObject({
  category: 'data',
  code: 'AI_CANDIDATE_QUALITY_BLOCKED',
  aiCanRepair: true,
  retryCurrentPlan: false,
  qualityReport: {
    status: 'blocked',
    issues: [expect.objectContaining({ paths: ['/atomicEvents/0/name'] })],
  },
});
```

分别覆盖 compare 和 plans 路由，另保留 JSON 语法错误、8 MiB 限制、401、503 回归断言。

- [ ] **Step 2: 运行路由测试并确认当前只返回 `VALIDATION_ERROR`**

Run: `pnpm --filter @causality/api test -- ai-capture-routes.test.ts`

Expected: FAIL，当前响应没有质量报告。

- [ ] **Step 3: 将 Fastify validation 转成 Zod/JSON Pointer 质量报告**

`routeParserError()` 从 `error.validation` 中优先读取 Zod `params.issue.path`，回退到 Fastify `instancePath`；所有路径经过统一 JSON Pointer 规范化。compare 路由使用候选阶段消息，plans 路由使用方案阶段消息；解析器无法提供具体字段时使用 `/`，不再返回只有“请求参数不合法”的 400。

- [ ] **Step 4: 序列化专用质量阻断错误**

```ts
if (error instanceof AiCaptureQualityBlockedError) {
  return reply.status(400).send({
    category: 'data',
    code: error.code,
    message: error.message,
    affectedRefs: error.affectedRefs,
    aiCanRepair: true,
    retryCurrentPlan: false,
    suggestedAction:
      error.code === 'AI_CANDIDATE_QUALITY_BLOCKED'
        ? '根据质量报告修正完整候选集合后重新对比'
        : '根据质量报告修正完整决策集合后重新生成方案',
    qualityReport: error.qualityReport,
  } satisfies AiWorkflowError);
}
```

提交阶段若已经携带 `qualityReport` 的 `AiWorkflowError`，分类器必须原样保留；系统和配置错误不虚构质量报告。

- [ ] **Step 5: 运行路由单元、HTTP 集成和类型检查**

Run:

```bash
pnpm --filter @causality/api test -- ai-capture-routes.test.ts
pnpm --filter @causality/api test:integration -- ai-capture-routes.integration.test.ts
pnpm --filter @causality/api typecheck
```

Expected: 全部 PASS。

- [ ] **Step 6: 创建本地 HTTP 错误提交**

```bash
git add apps/api/src/features/ai-capture/aiCaptureRoutes.ts apps/api/src/features/ai-capture/aiWorkflowErrorClassifier.ts apps/api/test/ai-capture-routes.test.ts apps/api/test/ai-capture-routes.integration.test.ts
git commit -m "feat: return structured AI quality errors"
```

---

### Task 7: MCP 契约镜像、错误透传与可读摘要

**Files:**

- Modify: `apps/mcp/src/tools/captureMcpSchemas.ts`
- Modify: `apps/mcp/src/api/causalityApiClient.ts`
- Modify: `apps/mcp/src/tools/registerCaptureTools.ts`
- Test: `apps/mcp/test/causalityApiClient.test.ts`
- Test: `apps/mcp/test/captureTools.test.ts`

**Interfaces:**

- Consumes: API `AiCaptureQualityReport` 和带报告的 `AiWorkflowError`。
- Produces: 与 contracts 同形的 MCP 严格镜像、`CausalityApiClientError.qualityReport` 和普通语言质量摘要。

- [ ] **Step 1: 写 API 客户端和 MCP 文本失败测试**

```ts
expect(error).toMatchObject({
  code: 'AI_CANDIDATE_QUALITY_BLOCKED',
  qualityReport: blockedReport,
});

expect(result.content[0]?.text).toContain('质量检查：存疑');
expect(result.content[0]?.text).toContain('阻断问题：0');
expect(result.content[0]?.text).toContain('存疑问题：1');
expect(result.structuredContent).toMatchObject({ qualityReport: warningReport });
```

- [ ] **Step 2: 运行 MCP 测试并确认报告被严格 Schema 丢弃或错误类未保存**

Run: `pnpm --filter @causality/mcp test -- causalityApiClient.test.ts captureTools.test.ts`

Expected: FAIL。

- [ ] **Step 3: 增加 transport-only 质量 Schema**

`captureMcpSchemas.ts` 镜像 contracts 中的问题代码、状态、阶段、实体类型、issue、topic signal 和 report；`captureComparisonMcpSchema.qualityReport` 使用 optional/default 兼容旧客户端，`workflowError.qualityReport` 为 optional。不得从 contracts 的 transform Schema 直接生成 MCP JSON Schema。

- [ ] **Step 4: 在 API 客户端错误中保留完整报告**

```ts
interface CausalityApiClientErrorOptions {
  kind: CausalityApiClientErrorKind;
  code: string;
  message: string;
  status?: number;
  traceId?: string;
  workflowError?: AiWorkflowError;
  cause?: unknown;
  qualityReport?: AiCaptureQualityReport;
}

export class CausalityApiClientError extends Error {
  public readonly qualityReport?: AiCaptureQualityReport;
}
```

`apiFailure()` 仅在 `aiWorkflowErrorSchema.safeParse(payload)` 成功时复制报告；契约错误、401 和普通系统错误不伪造报告。

- [ ] **Step 5: 实现紧凑的普通语言质量摘要**

```ts
function qualityText(report: AiCaptureQualityReport): string[] {
  const errors = report.issues.filter((issue) => issue.severity === 'error');
  const warnings = report.issues.filter((issue) => issue.severity === 'warning');
  return [
    `质量检查：${report.status === 'passed' ? '通过' : report.status === 'warning' ? '存疑' : '阻断'}`,
    `- 阻断问题：${errors.length}`,
    `- 存疑问题：${warnings.length}`,
    ...report.issues.map(
      (issue) =>
        `- [${issue.code}] ${issue.message}；相关项：${issue.refs.join('、') || '批次'}；建议：${issue.suggestedAction}`,
    ),
  ];
}
```

对比和方案成功文本使用该摘要；主题分数只存在于 `structuredContent`。失败文本展示问题代码、路径、相关 ref 和建议动作。`workflowError()` 原样复制 `qualityReport`。

- [ ] **Step 6: 运行 MCP 测试、类型检查和工具数量回归**

Run:

```bash
pnpm --filter @causality/mcp test -- causalityApiClient.test.ts captureTools.test.ts
pnpm --filter @causality/mcp typecheck
```

Expected: 全部 PASS；工具总数仍为 11，Prompt 名称不变。

- [ ] **Step 7: 创建本地 MCP 透传提交**

```bash
git add apps/mcp/src/tools/captureMcpSchemas.ts apps/mcp/src/api/causalityApiClient.ts apps/mcp/src/tools/registerCaptureTools.ts apps/mcp/test/causalityApiClient.test.ts apps/mcp/test/captureTools.test.ts
git commit -m "feat: expose AI capture quality through MCP"
```

---

### Task 8: V2 Prompt 服务端报告自动修复循环

**Files:**

- Modify: `apps/mcp/src/prompts/capturePrompt.ts`
- Modify: `prompts/causality-capture.md`
- Test: `apps/mcp/test/capturePrompt.test.ts`

**Interfaces:**

- Consumes: MCP 工具返回的 `qualityReport.status`、`issues`、`paths`、`refs`、`aiCanRepair` 和 `suggestedAction`。
- Produces: 在首次用户可读方案前自动修复、重对比和三分类的唯一规范文本。

- [ ] **Step 1: 写 Prompt 规则失败测试**

```ts
expect(prompt).toContain('服务端质量报告优先于 AI 自检结论');
expect(prompt).toContain('报告状态为 blocked');
expect(prompt).toContain('必须重新提交完整候选集合');
expect(prompt).toContain('无法修复的内容移入忽略数据');
expect(prompt).toContain('报告状态为 warning');
expect(prompt).toContain('默认归入存疑数据并使用 skip');
expect(prompt).toContain('不得根据 topicRelevance 单独建立或否定因果关系');
```

- [ ] **Step 2: 运行 Prompt 测试并确认新规则缺失**

Run: `pnpm --filter @causality/mcp test -- capturePrompt.test.ts`

Expected: FAIL。

- [ ] **Step 3: 在自动生成方案流程中加入服务端报告循环**

明确写入以下顺序：`blocked` 时按路径和 ref 修正同一完整工作集，合并后重写全部引用，不能修复则归入忽略数据，然后重新执行对比；`warning` 时由 AI 结合会话事实判断，默认受影响项进入存疑数据并使用 skip；只有不再 blocked 才调用 `prepare_knowledge_changes`。系统或配置错误仍停止等待人工处理。

- [ ] **Step 4: 明确主题信号的使用边界**

Prompt 只允许将 `topicRelevance` 用于同批次事件与主题锚点的相对复核；禁止设置固定阈值、禁止用它证明或否定因果关系、禁止因单一低分自动删除真实主体或限定语不同的事件。

- [ ] **Step 5: 生成便携 Prompt 并验证完全一致**

Run:

```bash
pnpm --filter @causality/mcp prompt:generate
pnpm --filter @causality/mcp test -- capturePrompt.test.ts
```

现有 `capturePrompt.test.ts` 的字节一致性断言必须验证生成后的 `prompts/causality-capture.md` 与 `buildCausalityCapturePrompt()` 完全一致。

- [ ] **Step 6: 创建本地 Prompt 提交**

```bash
git add apps/mcp/src/prompts/capturePrompt.ts apps/mcp/test/capturePrompt.test.ts prompts/causality-capture.md
git commit -m "docs: teach AI clients to repair quality reports"
```

---

### Task 9: 全链路回归、文档状态与人工复核交付

**Files:**

- Modify: `docs/superpowers/specs/2026-07-29-p3-01r1-task3-server-candidate-quality-gate-design.md`
- Modify: `docs/superpowers/specs/2026-07-29-p3-01r1-mcp-quality-query-optimization-design.md`
- Modify: `docs/superpowers/plans/2026-07-20-causality-application-roadmap.md`
- Test: `packages/contracts/test/ai-capture.test.ts`
- Test: `apps/api/test/ai-capture-routes.integration.test.ts`
- Test: `apps/api/test/ai-candidate-comparison.integration.test.ts`
- Test: `apps/api/test/ai-import-plan.integration.test.ts`
- Test: `apps/mcp/test/captureTools.test.ts`

**Interfaces:**

- Consumes: Tasks 1–8 的完整契约、API 和 MCP 行为。
- Produces: 可人工复核的 Task 3 发布候选，以及状态为“等待人工复核”的阶段文档。

- [ ] **Step 1: 增加一条完整自动修复后的 HTTP/MCP 回归场景**

场景固定为：第一次提交包含重复事件、重复案例、缺失引用和自环并得到 blocked；第二次提交修复引用后得到 warning（无案例关系和传递捷径）；方案请求把受影响项设为 skip 后成功生成；工具结构化内容和普通文本保留相同的 warning；未调用 commit。

- [ ] **Step 2: 运行受影响工作区全部测试**

Run:

```bash
pnpm --filter @causality/contracts test
pnpm --filter @causality/api test
pnpm --filter @causality/mcp test
pnpm test:integration
```

Expected: 全部 PASS；集成测试使用当前 Docker context 下的 PostgreSQL，不改动开发数据库数据。

- [ ] **Step 3: 运行全仓质量门禁**

Run:

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
```

Expected: 全部 PASS。

- [ ] **Step 4: 更新任务状态但不提前标记完成**

把 Task 3 设计、P3-01R1 阶段设计和总体 roadmap 更新为“实施完成，等待人工复核”；记录自动化命令和结果。不得把 Task 3 或 P3-01R1 标为“已完成”，直到用户完成人工复核。

- [ ] **Step 5: 执行人工复核清单**

1. 通过 MCP 提交重复事件、重复案例、缺失引用、自环和孤立候选，确认 AI 自动修复后才生成方案。
2. 提交疑似复合事件、无案例关系和 `A→B→C` 加 `A→C`，确认只显示存疑。
3. 删除或伪造方案参数中的质量报告，确认服务端仍返回本次真实报告。
4. 确认主题相关性分数不直接改变三分类或因果关系。
5. 确认用户明确确认前不调用 `commit_knowledge_changes`。

- [ ] **Step 6: 创建本地 Task 3 发布候选提交**

```bash
git add packages/contracts/src/ai-capture packages/contracts/src/index.ts packages/contracts/test/ai-capture.test.ts apps/api/src/features/ai-capture apps/api/test/ai-capture-quality-gate.test.ts apps/api/test/ai-candidate-comparison-service.test.ts apps/api/test/ai-candidate-comparison.integration.test.ts apps/api/test/ai-import-plan-service.test.ts apps/api/test/ai-import-plan.integration.test.ts apps/api/test/ai-capture-routes.test.ts apps/api/test/ai-capture-routes.integration.test.ts apps/api/test/ai-semantic-candidate-service.test.ts apps/mcp/src apps/mcp/test prompts/causality-capture.md docs/superpowers/specs/2026-07-29-p3-01r1-task3-server-candidate-quality-gate-design.md docs/superpowers/specs/2026-07-29-p3-01r1-mcp-quality-query-optimization-design.md docs/superpowers/plans/2026-07-20-causality-application-roadmap.md
git commit -m "feat: complete AI capture quality gate"
```

检查 `git status --short`，确认用户自有文件仍未暂存；本任务不执行 `git push`。

#### Task 9 执行记录

实施和自动化验证已完成，人工复核未执行。Task 3 和 P3-01R1 仍不标记为“已完成”。

- RED：HTTP 路由回归首次发现 Fastify 适配层把 `AI_QUALITY_REFERENCE_MISSING` 和 `AI_QUALITY_SELF_LOOP` 降级为 `AI_QUALITY_SCHEMA_INVALID` 并丢失 ref；MCP 回归首次发现 compare/prepare 跨字段问题在本地被拦截，请求未到达 API。
- GREEN：路由保留 Fastify 暴露的 Zod `qualityCode`、`entityType`、JSON Pointer 和关联 ref；MCP 仅验证传输形状，把 compare/prepare 跨字段质量判定交给 API。聚焦 API 单测 2 项、路由集成 3 项和 MCP 回归 1 项通过。
- 受影响工作区：`pnpm --filter @causality/contracts test` 11 文件/85 项，`pnpm --filter @causality/api test` 34 文件/353 项，`pnpm --filter @causality/mcp test` 6 文件/47 项，全部通过。
- 集成：使用 `DOCKER_HOST="$(docker context inspect --format '{{.Endpoints.docker.Host}}')"` 和 `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock` 运行 `pnpm test:integration`；API 26 文件/222 项、Semantic Worker 2 文件/47 项通过。
- 全仓：`pnpm lint` 通过，`pnpm format:check` 通过，`pnpm typecheck` 6 工作区通过，`pnpm test` 122 文件/868 项通过，`pnpm build` 6 工作区通过。
- 工具卫生范围修正：`.prettierignore` 仅忽略已生成的 `database/migrations/meta/0020_snapshot.json` 和用户自有 `research/`；两者均未修改。

---

## Self-review result

- Spec coverage: 候选期 11 条阻断规则、4 条存疑规则、对比期 4 条重复规则、主题信号、方案期重算、Fastify 路径、MCP 透传、Prompt 自动修复和兼容策略均有对应任务。
- Boundary check: Web、数据库迁移、历史页面、业务数据表、提交事务、工具数量和通用写能力均未进入修改范围。
- Type consistency: `AiCaptureQualityReport`、`qualityReport`、`topicRelevance`、`inspectCandidates`、`inspectComparison` 和 `inspectPlan` 在所有任务中名称一致。
- Trust boundary: Task 5 明确重新生成主题信号和问题报告，再覆盖客户端 `comparison.qualityReport`。
- Placeholder scan: 计划中没有待定规则；语义重复 warning 使用固定且仅提示用的 `0.90` 门槛，主题相关性不设阈值。
