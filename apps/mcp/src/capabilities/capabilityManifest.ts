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
  inferOutcomes: 'causality_infer_outcomes',
} as const;

export const MCP_RESOURCE_URIS = {
  domainModel: 'causality://rules/domain-model',
  captureRules: 'causality://rules/capture',
  capabilities: 'causality://capabilities',
  systemStatus: 'causality://system/status',
} as const;

export type McpToolName = (typeof MCP_TOOL_NAMES)[keyof typeof MCP_TOOL_NAMES];
export type CapabilityAccess = 'read_only' | 'controlled_write';

interface McpToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: false;
}

export interface McpToolCapability {
  name: McpToolName;
  title: string;
  description: string;
  purpose: string;
  access: CapabilityAccess;
  annotations: McpToolAnnotations;
}

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const prepareAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

const commitAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const tools: McpToolCapability[] = [
  {
    name: MCP_TOOL_NAMES.searchAtomicEvents,
    title: '搜索原子事件',
    description:
      '只读工具。按名称、别名或关键词执行普通搜索，仅在明确要求时使用语义增强；查询最长 80 字、页码最多 100000。取得候选 ID 后使用事件详情或路径工具核对。',
    purpose: '搜索原子事件',
    access: 'read_only',
    annotations: readOnlyAnnotations,
  },
  {
    name: MCP_TOOL_NAMES.getAtomicEvent,
    title: '查看原子事件',
    description:
      '只读工具。使用有效原子事件 UUID 读取详情和一页关联关系；每页最多 100 条并通过游标续页。需要完整证据时继续读取关系详情和案例。',
    purpose: '读取原子事件详情',
    access: 'read_only',
    annotations: readOnlyAnnotations,
  },
  {
    name: MCP_TOOL_NAMES.searchConcreteCases,
    title: '搜索具体案例',
    description:
      '只读工具。按最长 100 字的案例内容关键词分页搜索，页码最多 100000。取得案例 ID 后使用案例详情工具核对关联关系。',
    purpose: '搜索具体案例',
    access: 'read_only',
    annotations: readOnlyAnnotations,
  },
  {
    name: MCP_TOOL_NAMES.getCausalRelation,
    title: '查看因果关系',
    description:
      '只读工具。使用有效因果关系 UUID 读取方向、置信度、案例数和说明。需要案例证据时继续调用关系案例工具。',
    purpose: '读取因果关系详情',
    access: 'read_only',
    annotations: readOnlyAnnotations,
  },
  {
    name: MCP_TOOL_NAMES.getRelationCases,
    title: '查看关系案例',
    description:
      '只读工具。使用有效因果关系 UUID 分页读取关联案例；每页最多 100 条并通过游标续页。只在确有需要时续取至 hasMore=false。',
    purpose: '读取关系案例',
    access: 'read_only',
    annotations: readOnlyAnnotations,
  },
  {
    name: MCP_TOOL_NAMES.queryLocalCausalGraph,
    title: '查询局部因果图',
    description:
      '只读工具。使用有效中心事件和上游、下游或双向方向查询局部图；原子事件上限只能为 20、50 或 100。下结论前必须检查停止原因和截断状态。',
    purpose: '查询局部因果图',
    access: 'read_only',
    annotations: readOnlyAnnotations,
  },
  {
    name: MCP_TOOL_NAMES.getConcreteCase,
    title: '查看具体案例',
    description:
      '只读工具。使用有效具体案例 UUID 读取详情和一页关联关系；每页最多 100 条并通过游标续页。需要因果信息时继续读取关系详情。',
    purpose: '读取具体案例详情',
    access: 'read_only',
    annotations: readOnlyAnnotations,
  },
  {
    name: MCP_TOOL_NAMES.searchCausalRelations,
    title: '搜索因果关系',
    description:
      '只读工具。按原因事件、结果事件或关系说明执行普通或明确请求的语义增强搜索，页码最多 100000。取得关系 ID 后使用详情或证据工具核对。',
    purpose: '搜索因果关系',
    access: 'read_only',
    annotations: readOnlyAnnotations,
  },
  {
    name: MCP_TOOL_NAMES.findCausalPaths,
    title: '查询因果路径',
    description:
      '只读工具。使用两个原子事件 UUID 沿真实方向查询简单路径；深度最多 10、路径最多 10，并受扩展状态上限约束。选定路径后使用证据包核对。',
    purpose: '查询受限有向因果路径',
    access: 'read_only',
    annotations: readOnlyAnnotations,
  },
  {
    name: MCP_TOOL_NAMES.getCausalEvidenceBundle,
    title: '生成因果证据包',
    description:
      '只读工具。按顺序提交 1 至 10 个关系 UUID，最多读取 10 段关系和限量案例。输出时必须说明无案例关系和案例截断。',
    purpose: '读取一条路径的关系和案例证据',
    access: 'read_only',
    annotations: readOnlyAnnotations,
  },
  {
    name: MCP_TOOL_NAMES.compareKnowledgeCandidates,
    title: '对比知识候选',
    description:
      '只读工具。一次对比完整关联的事件、案例、关系和案例关联候选，原子事件最多 50 条。处理质量问题后再生成入库方案。',
    purpose: '对比采集候选与现有知识',
    access: 'read_only',
    annotations: readOnlyAnnotations,
  },
  {
    name: MCP_TOOL_NAMES.prepareKnowledgeChanges,
    title: '生成入库方案',
    description:
      '受控写入工具。根据完整候选、对比和决策只生成限时有效的不可变方案，不写入正式知识。提交前先展示并核对最新方案。',
    purpose: '生成受控、限时有效的入库方案',
    access: 'controlled_write',
    annotations: prepareAnnotations,
  },
  {
    name: MCP_TOOL_NAMES.getImportPlanStatus,
    title: '查询入库方案状态',
    description:
      '只读工具。使用有效方案 UUID 检查方案是否待提交、已失效或已进入终态。根据当前状态决定提交、重新对比或重新生成方案。',
    purpose: '读取入库方案状态',
    access: 'read_only',
    annotations: readOnlyAnnotations,
  },
  {
    name: MCP_TOOL_NAMES.commitKnowledgeChanges,
    title: '确认执行入库方案',
    description:
      '受控事务写入工具。只能提交有效且经过用户明确确认的最新完整方案；同一方案保持幂等。响应不明确时使用结果查询工具恢复。',
    purpose: '提交用户已确认的入库方案',
    access: 'controlled_write',
    annotations: commitAnnotations,
  },
  {
    name: MCP_TOOL_NAMES.getImportResult,
    title: '查询入库结果',
    description:
      '只读工具。使用有效的成功 AI 导入历史 UUID 读取幂等结果和采集标记。用于提交响应不明确后的恢复或成功结果追溯。',
    purpose: '读取成功入库结果',
    access: 'read_only',
    annotations: readOnlyAnnotations,
  },
];

export const MCP_CAPABILITY_COUNTS = {
  tools: 15,
  prompts: 5,
  resources: 4,
} as const;

export const MCP_CAPABILITY_MANIFEST = {
  schemaVersion: 1,
  server: {
    name: CAUSALITY_MCP_NAME,
    version: CAUSALITY_MCP_VERSION,
  },
  tools,
  prompts: [
    { name: MCP_PROMPT_NAMES.capture, purpose: '采集当前会话并生成受控入库方案' },
    { name: MCP_PROMPT_NAMES.analyzeEvent, purpose: '分析事件的直接原因与结果' },
    { name: MCP_PROMPT_NAMES.tracePath, purpose: '追踪两个事件之间的有向因果路径' },
    { name: MCP_PROMPT_NAMES.reviewChain, purpose: '逐段审查用户提出的因果链' },
    { name: MCP_PROMPT_NAMES.inferOutcomes, purpose: '推测单个事件可能产生的后续结果' },
  ],
  resources: [
    { uri: MCP_RESOURCE_URIS.domainModel, purpose: '读取领域建模与证据边界' },
    { uri: MCP_RESOURCE_URIS.captureRules, purpose: '读取会话采集与受控入库规则' },
    { uri: MCP_RESOURCE_URIS.capabilities, purpose: '读取 MCP 能力与稳定限制' },
    { uri: MCP_RESOURCE_URIS.systemStatus, purpose: '读取本地系统实时可用状态' },
  ],
  limits: {
    eventAnalysisInspectedRelations: 100,
    eventAnalysisDisplayedRelations: 5,
    casesPerDisplayedRelation: 3,
    pathDefaultDepth: 5,
    pathMaximumDepth: 10,
    pathQueryLimit: 10,
    pathDisplayedLimit: 3,
    pathExpandedStateLimit: 10_000,
    chainSegmentLimit: 10,
    outcomeInferenceDefaultDepth: 3,
    outcomeInferenceDisplayedResults: 5,
    outcomeInferenceNodeLimits: [20, 50, 100] as const,
    outcomeInferencePathQueryLimit: 10,
    outcomeInferenceDisplayedPathsPerResult: 3,
    outcomeInferenceCasesPerRelation: 3,
  },
  compatibility: {
    toolsWorkWithoutPromptsOrResources: true,
  },
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
