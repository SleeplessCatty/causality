import { MCP_TOOL_NAMES } from '../capabilities/capabilityManifest.js';
import { buildSharedAnalysisPolicy } from './analysisPolicy.js';

export const OUTCOME_INFERENCE_READ_TOOL_NAMES = [
  MCP_TOOL_NAMES.searchAtomicEvents,
  MCP_TOOL_NAMES.getAtomicEvent,
  MCP_TOOL_NAMES.queryLocalCausalGraph,
  MCP_TOOL_NAMES.getCausalRelation,
  MCP_TOOL_NAMES.getRelationCases,
  MCP_TOOL_NAMES.getConcreteCase,
  MCP_TOOL_NAMES.findCausalPaths,
  MCP_TOOL_NAMES.getCausalEvidenceBundle,
] as const;

export function buildInferOutcomesPrompt(): string {
  return `# Causality 基于知识库的结果推测

规则版本：V1

你负责从当前可见会话识别用户关心的一个起始事件，使用 Causality 数据库中的下游关系、路径和案例，给出最多五个有库内依据的候选结果。只支持一个起始事件；多个事件共同作用不属于本流程。

${buildSharedAnalysisPolicy({ readToolNames: OUTCOME_INFERENCE_READ_TOOL_NAMES })}

## 起始事件匹配

1. 先调用 \`search_atomic_events\`，使用 \`searchMode = standard\`。
2. 普通结果不能形成可靠唯一候选时，才使用 \`searchMode = enhanced\`。
3. 对唯一候选调用 \`get_atomic_event\`，核对名称、说明、别名、关键词、主体、范围、状态和方向。
4. 多个候选仍无法排除歧义时请用户选择；没有可靠匹配时停止，不使用模型常识替代数据库事件。

## 下游候选查询

1. 调用 \`query_local_causal_graph\`，固定使用 \`direction = downstream\`、\`minConfidence = 0\`、\`minCaseCount = 0\`，首次 \`limit = 20\`。
2. 达到原子事件数量限制且尚不足五个相关候选时按 \`20 → 50 → 100\` 扩展；一百个原子事件后停止。
3. 根据返回的有向关系重建从起始事件出发的最短层级，默认只保留 3 层以内可达的结果。方向相反、不可达或超过三层的原子事件不能作为候选。
4. 最多展示 5 个候选结果。先按当前会话关注点的相关性选择，再比较路径证据和距离。相关性只能排序已有结果，不能发明关系或跳过中间事件。
5. 多条路径指向同一结果时合并为一个候选结果。

## 路径和案例验证

1. 对每个候选调用 \`find_causal_paths\`，使用 \`maxDepth = 3\`、\`pathLimit = 10\`、\`minConfidence = 0\`、\`minCaseCount = 0\`。
2. 只接受工具返回的真实有向路径。同一结果最多展示 3 条路径：第一条完整展开，其余先显示摘要。
3. 使用关系详情、关系案例或证据包读取路径证据，每段关系最多展示 3 个案例。相同关系只解释一次。
4. 没有案例的关系仍可参与，但必须写“无案例依据”。案例读取失败必须写“案例证据未加载”，不能写成没有案例。
5. 原子事件、因果关系或路径达到限制时写“查询结果可能不完整”。已经取得五个候选但局部图未穷尽时，说明本次不是全库穷举。

## 输出结构

1. **分析范围**：起始事件、下游方向、三层范围、候选上限和截断状态。
2. **结果摘要**：最多五个结果及直接或间接类型，只说明库内存在通向结果的路径。
3. **候选结果详情**：结果名称、与问题的相关性、主要路径、每段置信度、案例数、路径最低置信度关系、最多三条支持路径和案例依据。
4. **不确定性与限制**：无案例、未穷尽、截断、工具失败和外部信息边界。
5. **可继续追问**：建议以某个结果作为新的单一起始事件，或展开路径和案例。

路径最低置信度只用于指出数值最低的一段关系。不得把它解释为结果概率；不计算综合证据等级，不计算平均置信度、关系置信度乘积或结果发生概率。

数据库事实仅包括工具返回的事件、关系、置信度、案例、路径和截断状态。候选选择、排序和解释属于 AI 推测，必须分开表达。用户明确要求外部信息时，只能增加独立章节，不得把外部内容描述为库内事实。

用户要求保存任何推测或外部发现时，停止本流程并重新启动 \`causality_capture\`，不得直接调用采集或提交工具。
`;
}
