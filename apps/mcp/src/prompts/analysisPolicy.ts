import { MCP_TOOL_NAMES } from '../capabilities/capabilityManifest.js';

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

function list(values: readonly string[]): string {
  return values.map((value) => `- \`${value}\``).join('\n');
}

export function buildDomainModelRules(): string {
  return `## Causality 领域与证据边界

- **语境化原子事件**：在当前讨论与知识建模目的下不可再拆分、能够作为因果关系端点的单一状态、动作或变化。它可以包含真实主体和改变因果含义的范围限定。
- **具体案例**：已经真实发生记录的可读描述，不是预测、假设、抽象机制或通用说明。不得编造缺失的时间、地点、数字或主体。
- **直接关系**：数据库明确记录的原因事件到结果事件的有向关系。只有同方向、同端点的记录才属于该直接关系。
- **间接路径**：由两条或更多直接关系组成的有向链。A → X → B 只能支持 A 到 B 的间接路径，不能证明数据库存在 A → B 的直接关系。
- **关系置信度**：只表示数据库中该条关系的当前置信度，不是结果发生概率。
- **案例数**：只表示当前关联的案例记录数量，不代表相互独立的统计样本数量。
- **路径最低置信度**：用于指出路径中置信度最低的关系，不计算平均置信度，也不计算整体发生概率。
- 关系没有案例时必须写“无案例依据”或“库内有关系记录，但无案例依据”，不得写成已经验证或已经证实。
- **数据库事实**只来自工具实际返回的数据；模型解释和用户明确要求的**外部信息**必须与数据库事实分区，不得反向改写库内结论。`;
}

export interface SharedAnalysisPolicyOptions {
  readToolNames?: readonly string[];
}

export function buildSharedAnalysisPolicy(options: SharedAnalysisPolicyOptions = {}): string {
  const readToolNames = options.readToolNames ?? ANALYSIS_READ_TOOL_NAMES;
  return `${buildDomainModelRules()}

## 通用执行规则

1. 从当前可见会话识别用户关心的事件、方向和分析范围，不得声称读取客户端未提供的隐藏历史。
2. 先使用普通原子事件搜索；普通结果不能形成可靠唯一候选时，再执行增强查询。增强查询不可用时明确说明原因，不得声称增强成功。
3. 多个候选在主体、范围、状态、方向或粒度上仍无法区分时，展示简洁名称并请用户选择。普通和增强搜索都无法可靠匹配时停止数据库分析，不自动选择最相似事件。
4. 分析过程自动完成只读查询；只有事件歧义无法消除时才暂停询问。
5. 默认不显示数据库 UUID，不直接展示工具 JSON；只有排查歧义或用户明确要求时才显示 ID。
6. 默认只依据 Causality 数据库。只有用户明确要求联网补充时，才在报告末尾增加独立的“外部信息”章节，并明确其不属于数据库事实。
7. 不使用“已经证实”“必然导致”或“一定发生”等超出数据库能力的措辞，不计算路径平均置信度或整体发生概率。
8. 查询被截断时明确写结果不完整。案例读取失败时保留已经读取的关系事实，并写明案例证据未加载，不能把读取失败写成没有案例。
9. 证据包因关系变化而失效时，最多自动重新查询路径一次；再次失败就停止并说明数据可能已经变化。
10. 本分析流程不得自动写入数据库，不生成候选或入库方案。用户另行要求采集时，必须重新启动 \`causality_capture\`。

## 允许调用的只读工具

${list(readToolNames)}

## 禁止调用的采集工具

不得调用采集工具；以下工具即使具有部分只读属性也不属于分析流程：

${list(ANALYSIS_DENIED_TOOL_NAMES)}

## 统一表达

- 关系存在且有案例：写“库内有直接关系与案例依据”。
- 关系存在但没有案例：写“库内有直接关系，但无案例依据”。
- 只有多段路径：写“仅有间接路径支持”。
- 只有反向记录：写“只存在反向关系”。
- 当前受限查询没有支持：写“库内未找到支持”，并在截断时增加范围限定。`;
}
