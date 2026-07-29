# P3-01R1 Task 3 服务端候选质量门禁设计

日期：2026-07-29
状态：已完成
所属阶段：P3-01R1 MCP 查询完整性与采集质量优化

## 1. 目标

在现有 AI 自动提取、候选对比、三分类方案和事务入库流程之间增加服务端候选质量门禁，防止仅依赖 Prompt 约束导致结构错误、批次重复、孤立数据或明显不合理的关系进入不可变入库方案。

本任务实现：

- 在数据库和语义查询前执行低成本确定性检查；
- 在库内对比后返回重复和相关性信号；
- 在生成方案前根据最终决策重新计算质量结果；
- 用结构化问题、字段路径、相关 `ref` 和建议动作帮助 AI 自动修正；
- 阻断问题不生成方案，存疑问题允许进入用户审核流程；
- 服务端不信任客户端回传的质量结论，必须重新计算。

质量门禁只判断候选结构和可以稳定识别的风险，不替代外部 AI 或用户判断真实世界的因果关系是否成立。

## 2. 与三分类方案的关系

Task 2 已确定 AI 在首次方案前自动将全部提取结果分为确信数据、存疑数据和忽略数据。

- **确信数据**：不包含服务端阻断问题，AI 可以可靠决定 `create/reuse`；
- **存疑数据**：服务端返回存疑问题，或 AI 对新增、复用和边界仍不确定；默认 `skip` 并在方案中说明；
- **忽略数据**：无法通过质量门禁、与主线无关或依据不足；从 MCP 候选集合移除，但继续显示在当前会话的用户可读方案中。

从开始提取到首次完整方案仍由 AI 自动执行。收到阻断报告后，AI 自动修正、合并、拆分或移除相关候选并重新对比；不能修复的内容归入忽略数据。首次完整方案生成前不要求用户逐项处理质量问题。

## 3. 领域术语

### 3.1 候选质量报告

服务端对一个完整候选集合或方案决策集合执行检查后产生的版本化结构化结果。

### 3.2 阻断问题

可以依据 Schema、引用、唯一性或确定性依赖规则确认的问题。存在阻断问题时，不得继续昂贵查询或生成不可变方案。

### 3.3 存疑问题

可以稳定发现风险线索、但不能仅由服务端确认数据错误的问题。存疑问题不自动阻止方案生成，由 AI 默认归入存疑数据并交给用户审核。

### 3.4 质量信号

不直接判定问题、只辅助 AI 分类的数据，例如原子事件与主题锚点的语义相似度。质量信号不改变报告状态，也不能证明因果关系。

这些术语在设计审核通过后同步到 `CONTEXT.md`。

## 4. 质量报告接口

新增共享契约：

```ts
type AiCaptureQualityStatus = 'passed' | 'warning' | 'blocked';
type AiCaptureQualitySeverity = 'error' | 'warning';
type AiCaptureQualityPhase = 'candidate' | 'comparison' | 'plan';
type AiCaptureQualityEntityType = 'batch' | 'event' | 'case' | 'relation' | 'link';

interface AiCaptureQualityIssue {
  code: AiCaptureQualityIssueCode;
  severity: AiCaptureQualitySeverity;
  phase: AiCaptureQualityPhase;
  entityType: AiCaptureQualityEntityType;
  refs: string[];
  paths: string[];
  message: string;
  suggestedAction: string;
  aiCanRepair: boolean;
}

interface AiCaptureTopicRelevanceSignal {
  ref: string;
  similarity: number;
}

interface AiCaptureQualityReport {
  version: 1;
  status: AiCaptureQualityStatus;
  issues: AiCaptureQualityIssue[];
  topicRelevance: AiCaptureTopicRelevanceSignal[];
}
```

`paths` 使用 JSON Pointer，例如 `/atomicEvents/0/name`。数组顺序固定为“严重程度—问题代码—首个字段路径—首个 ref”，确保重复请求返回稳定结果。

状态派生规则：

- 存在 `error`：`blocked`；
- 没有 `error`、存在 `warning`：`warning`；
- 没有问题：`passed`。

主题相关性分数只是信号，不参与上述状态计算。

## 5. 契约兼容策略

### 5.1 候选对比结果

`AiCaptureComparison` 增加 `qualityReport`。新服务端始终返回该字段；共享输入 Schema 对缺少该字段的旧调用使用空的 V1 报告默认值，保证旧客户端仍可提交。

### 5.2 工作流错误

`AiWorkflowError` 增加可选 `qualityReport`。候选或方案被门禁阻断时返回完整报告；系统、配置或既有提交错误可以不带报告。

### 5.3 MCP 镜像 Schema

MCP 传输 Schema 同步增加可选质量报告，工具输出始终携带服务端实际报告。仍保持 11 个现有工具和 `causality_capture` Prompt，不新增质量检查工具。

### 5.4 旧方案读取

旧方案 JSON 中没有质量报告时按空的 V1 报告读取，不要求数据库迁移。新方案保存服务端重新计算的报告，不保存客户端伪造或删改后的报告。

## 6. 深模块和执行顺序

新增 `AiCaptureQualityGate` 深模块，复杂规则集中在该模块中，路由、候选对比和方案事务只依赖它的小接口：

```ts
interface AiCaptureQualityGate {
  inspectCandidates(input: AiCaptureCandidateSet): AiCaptureQualityReport;
  inspectComparison(input: {
    candidates: AiCaptureCandidateSet;
    comparison: AiCaptureComparison;
    topicRelevance: AiCaptureTopicRelevanceSignal[];
  }): AiCaptureQualityReport;
  inspectPlan(input: PrepareAiImportPlanInput): AiCaptureQualityReport;
}
```

三个阶段：

1. **candidate**：路由完成基础 JSON 类型解析后执行确定性检查；有阻断问题时立即返回，不调用 PostgreSQL 或 Semantic Worker；
2. **comparison**：完成普通和语义匹配后合并存疑问题与主题相关性信号；
3. **plan**：忽略客户端回传的报告，根据候选、对比、决策和当前数据库状态重新检查；有阻断问题时不创建方案。

方案模块用重新计算的报告替换输入报告，再交给现有方案校验和仓储。现有事务提交、依赖指纹和幂等逻辑保持不变。

## 7. 候选阶段阻断规则

| 问题代码                            | 适用对象       | 判定规则                                    | 建议动作                   |
| ----------------------------------- | -------------- | ------------------------------------------- | -------------------------- |
| `AI_QUALITY_SCHEMA_INVALID`         | 批次/字段      | 类型、长度、必填字段或严格字段不符合 Schema | 按字段路径修正参数         |
| `AI_QUALITY_EVENT_LIMIT_EXCEEDED`   | 批次           | 去重前原子事件超过 50 条                    | 保留主线数据并移除其余内容 |
| `AI_QUALITY_DUPLICATE_REF`          | 事件/案例/关系 | 同类型候选 `ref` 重复                       | 合并候选并保留一个稳定 ref |
| `AI_QUALITY_REFERENCE_MISSING`      | 关系/关联      | 关系端点、关系或案例 ref 不存在             | 补齐引用或移除依赖项       |
| `AI_QUALITY_SELF_LOOP`              | 关系           | 原因和结果引用同一事件                      | 修正端点或移除关系         |
| `AI_QUALITY_DUPLICATE_LINK`         | 关联           | 同一 `relationRef + caseRef` 重复           | 合并重复关联               |
| `AI_QUALITY_DUPLICATE_EVENT_NAME`   | 事件           | 标准化后的事件名称重复                      | 合并为一个事件候选         |
| `AI_QUALITY_DUPLICATE_CASE_CONTENT` | 案例           | 去除首尾空白后的案例内容完全相同            | 合并为一个案例候选         |
| `AI_QUALITY_DUPLICATE_RELATION`     | 关系           | 原因 ref、结果 ref 和方向完全相同           | 合并为一条关系候选         |
| `AI_QUALITY_ORPHAN_EVENT`           | 事件           | 未作为任何候选关系端点                      | 移入忽略数据或补充有效关系 |
| `AI_QUALITY_ORPHAN_CASE`            | 案例           | 未被任何候选案例关联引用                    | 移入忽略数据或补充有效关联 |

现有 Zod 严格 Schema 继续作为第一层约束；跨字段检查由质量门禁统一负责。Fastify 校验错误也转换成带 JSON Pointer 的质量报告，不再只返回笼统的“请求参数不合法”。

## 8. 候选阶段存疑规则

| 问题代码                                   | 判定线索                                 | 说明                                        |
| ------------------------------------------ | ---------------------------------------- | ------------------------------------------- |
| `AI_QUALITY_COMPOUND_EVENT_SUSPECTED`      | 名称或说明中出现多个可独立变化及连接结构 | 只提示拆分风险，不依靠关键词直接判错        |
| `AI_QUALITY_ALIAS_COLLISION`               | 一个候选别名与另一个候选名称或别名相同   | 可能是同一事件的不同表达                    |
| `AI_QUALITY_RELATION_WITHOUT_CASE`         | 一条关系没有任何候选案例关联             | 允许保留 10% 基础置信度，只提示缺少案例依据 |
| `AI_QUALITY_TRANSITIVE_SHORTCUT_SUSPECTED` | 同批次同时存在 `A→B`、`B→C` 和 `A→C`     | 提醒检查 A 到 C 是否有独立直接依据          |

这些规则只产生 `warning`，不得让服务端声称关系错误。原子事件是否真正原子化、案例是否真实、关系是否确有因果性仍由 AI 根据会话事实分析并由用户确认。

## 9. 对比阶段规则与语义信号

库内对比完成后增加：

| 问题代码                                        | 判定规则                             | 严重程度 |
| ----------------------------------------------- | ------------------------------------ | -------- |
| `AI_QUALITY_EVENTS_SHARE_EXACT_MATCH`           | 多个事件候选唯一精确指向同一已有事件 | warning  |
| `AI_QUALITY_CASES_SHARE_EXACT_MATCH`            | 多个案例候选唯一精确指向同一已有案例 | warning  |
| `AI_QUALITY_EVENT_SEMANTIC_DUPLICATE_SUSPECTED` | 多个事件候选高相似指向同一已有事件   | warning  |
| `AI_QUALITY_CASE_SEMANTIC_DUPLICATE_SUSPECTED`  | 多个案例候选高相似指向同一已有案例   | warning  |

语义相似只能作为重复线索，不能自动决定复用。

Semantic Worker 额外为“主题 + 最多 50 个原子事件名称”生成同模型向量，并返回每个事件与主题的余弦相似度。由于四个模型分数分布不同且本阶段不建立跨模型评测集，服务端不设置新的主题相关性阈值，也不据此生成错误或警告；分数作为 `topicRelevance` 质量信号交给 AI 进行相对判断。

具体案例的主线归属通过其案例关联和关系端点判断，不额外对无限数量案例生成主题向量，避免扩大资源消耗。

## 10. 方案阶段规则

方案质量检查在读取当前数据库状态后执行，并重新计算而不是信任客户端报告。

新增阻断规则：

| 问题代码                                 | 判定规则                                                   |
| ---------------------------------------- | ---------------------------------------------------------- |
| `AI_QUALITY_ACTIVE_EVENT_ORPHANED`       | 决策为 `create/reuse` 的事件没有进入任何同样有效的关系决策 |
| `AI_QUALITY_ACTIVE_CASE_ORPHANED`        | 决策为 `create/reuse` 的案例没有进入任何有效案例关联决策   |
| `AI_QUALITY_DECISION_DEPENDENCY_INVALID` | 有效关系或案例关联依赖 `skip` 的上游决策                   |
| `AI_QUALITY_REPORT_BLOCKED`              | 重新计算后候选集合仍存在阻断问题                           |

现有以下校验继续保留并纳入结构化报告：

- 决策和对比结果必须完整覆盖候选集合；
- `reuse` ID 必须来自同一候选的对比结果；
- `create` 不得绕过已有精确记录；
- 数据库内容变化后旧对比失效；
- 批次内新增名称、案例、关系和关联必须唯一；
- 被 `skip` 的依赖不能被有效决策引用。

存疑问题不阻断方案生成。AI 按 V2 Prompt 默认把受影响项归入存疑数据并使用 `skip`；如果仍选择 `create/reuse`，服务端保留警告，最终由用户在完整方案中确认或要求修改。

## 11. 错误和自动修复循环

阻断时返回现有 `AiWorkflowError` 字段，并附带质量报告：

```json
{
  "category": "data",
  "code": "AI_CANDIDATE_QUALITY_BLOCKED",
  "message": "候选集合存在必须修复的质量问题",
  "affectedRefs": ["event-002"],
  "aiCanRepair": true,
  "retryCurrentPlan": false,
  "suggestedAction": "根据质量报告修正完整候选集合后重新对比",
  "qualityReport": {
    "version": 1,
    "status": "blocked",
    "issues": [],
    "topicRelevance": []
  }
}
```

AI 自动处理规则：

1. 根据问题路径和 `ref` 修复同一完整工作集；
2. 重复项合并后同步重写关系和案例关联引用；
3. 无法修复的内容移入忽略数据；
4. 重新执行候选对比；
5. 只有报告不再阻断时才生成方案；
6. 系统或配置错误仍停止并等待用户处理，不伪装为数据问题。

## 12. MCP 展示

`compare_knowledge_candidates` 的普通文本增加：

- 报告状态；
- 阻断问题数和存疑问题数；
- 每个问题的可读描述、相关候选和建议动作；
- 主题相关性只作为结构化信号，不在普通文本中逐条展开，避免输出冗长。

`prepare_knowledge_changes` 的普通文本在现有方案内容后增加“质量检查”摘要。MCP 不自行决定三分类，只向外部 AI 提供服务端事实和风险；三分类和用户可读完整方案仍由 V2 Prompt 编排。

## 13. 明确不包含

- 不增加新的 MCP 工具、Web 页面或数据库业务表；
- 不保存网页来源、完整对话或 AI 推理；
- 不使用本地嵌入模型证明因果关系；
- 不通过关键词规则自动否定一个原子事件；
- 不自动修改、合并或提交业务数据；
- 不建立跨模型采集质量测试集或质量评分排行；
- 不改变用户明确确认最新方案后才能入库的流程。

## 14. 预计修改范围

- `packages/contracts/src/ai-capture/`：质量报告、问题和兼容默认值 Schema；
- `apps/api/src/features/ai-capture/aiCaptureQualityGate.ts`：纯规则深模块；
- 候选对比模块：执行前置门禁、合并对比期问题和主题信号；
- 方案模块：服务端重新计算并替换质量报告；
- AI 捕获路由：字段路径和质量错误响应；
- MCP 传输 Schema、错误适配和可读文本；
- V2 Prompt：补充自动处理服务端报告的明确步骤；
- 对应 contracts、API、MCP 单元和集成测试。

不修改 Web、数据库迁移、AI 导入历史页面和正式业务数据表。

## 15. 自动化验收

1. 所有阻断规则和存疑规则具有表驱动单元测试；
2. 输入字段错误返回 JSON Pointer，而不是只有通用 400 文案；
3. 前置阻断时 PostgreSQL Repository 和 Semantic Worker 均未调用；
4. 允许关系没有案例，但返回稳定的存疑问题；
5. 可能的 `A→B→C` 压缩只警告，不自动删除 `A→C`；
6. 主题相似度只返回信号，不形成模型相关阻断；
7. 客户端删除或伪造质量报告后，方案模块仍以服务端重新计算结果为准；
8. 存在阻断问题时不创建方案、不写计划表；
9. 存疑问题允许生成方案并保留在质量摘要中；
10. 旧对比和旧方案缺少质量报告时仍可解析；
11. MCP 错误响应完整保留问题代码、路径、相关 ref 和建议动作；
12. 现有 11 个工具、Prompt、确认、幂等和事务回归全部通过；
13. Lint、类型检查、全仓测试、API 集成测试和生产构建通过。

## 16. 人工复核

1. 提交批次内重复事件、重复案例、缺失引用和自环，确认 AI 自动修复后才生成方案；
2. 提交疑似复合事件，确认只显示存疑而不会被服务端擅自删除；
3. 提交无案例关系，确认仍可生成 10% 基础置信度方案并显示提醒；
4. 提交 `A→B`、`B→C`、`A→C`，确认直接关系只被提醒检查；
5. 人工从 MCP 参数中删除质量报告后生成方案，确认服务端仍重新得到相同问题；
6. 修改候选解决问题后，确认新报告稳定消失；
7. 确认首次展示给用户的方案仍按确信、存疑和忽略三类组织；
8. 确认只有用户明确确认最新方案后才执行入库。

人工复核通过后，Task 3 标记完成，再进入 Task 4“只读查询与证据工具”设计阶段。

## 17. 实施与自动化验证记录

Task 3 已完成实施和人工复核，并于 2026-07-30 标记完成。P3-01R1 继续进入 Task 4“只读查询与证据工具”。

全链路回归覆盖：首次完整候选包含重复事件、重复案例、缺失引用和自环并被阻断；修正后的完整重提交只保留“无案例关系”和“传递快捷边”存疑；对受影响关系使用 `skip` 后成功生成待确认方案；HTTP、MCP 结构化内容和普通文本警告一致；全流程未调用 `commit_knowledge_changes`。

回归首次 RED 同时暴露两个公开边界缺口，并按 TDD 修复：Fastify 验证适配层曾丢失 Zod 的机器可读质量代码和关联 ref；MCP 处理器曾在请求到达 API 前提前执行跨字段精炼，导致服务端真实报告无法返回。修复后 API 继续是候选和方案质量的唯一信任边界，MCP 传输层仍保持严格的线上 JSON Schema。

自动化结果：

- 受影响工作区：Contracts 11 文件/85 项、API 34 文件/353 项、MCP 6 文件/47 项，全部通过；
- Docker 集成：API 26 文件/222 项、Semantic Worker 2 文件/47 项，全部通过；
- 全仓：`pnpm lint`、`pnpm format:check`、6 工作区 `typecheck`、122 文件/868 项 `pnpm test`、6 工作区 `pnpm build` 全部通过。

集成环境显式使用 `DOCKER_HOST="$(docker context inspect --format '{{.Endpoints.docker.Host}}')"` 和 `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`，测试仅使用 Testcontainers 创建的隔离 PostgreSQL，不改动开发数据库。
