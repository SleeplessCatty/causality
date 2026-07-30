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

type CapabilityAccess = 'read_only' | 'controlled_write';

interface ToolCapability {
  name: (typeof MCP_TOOL_NAMES)[keyof typeof MCP_TOOL_NAMES];
  purpose: string;
  access: CapabilityAccess;
}

const tools: ToolCapability[] = [
  { name: MCP_TOOL_NAMES.searchAtomicEvents, purpose: '搜索原子事件', access: 'read_only' },
  { name: MCP_TOOL_NAMES.getAtomicEvent, purpose: '读取原子事件详情', access: 'read_only' },
  { name: MCP_TOOL_NAMES.searchConcreteCases, purpose: '搜索具体案例', access: 'read_only' },
  { name: MCP_TOOL_NAMES.getCausalRelation, purpose: '读取因果关系详情', access: 'read_only' },
  { name: MCP_TOOL_NAMES.getRelationCases, purpose: '读取关系案例', access: 'read_only' },
  { name: MCP_TOOL_NAMES.queryLocalCausalGraph, purpose: '查询局部因果图', access: 'read_only' },
  { name: MCP_TOOL_NAMES.getConcreteCase, purpose: '读取具体案例详情', access: 'read_only' },
  { name: MCP_TOOL_NAMES.searchCausalRelations, purpose: '搜索因果关系', access: 'read_only' },
  { name: MCP_TOOL_NAMES.findCausalPaths, purpose: '查询受限有向因果路径', access: 'read_only' },
  {
    name: MCP_TOOL_NAMES.getCausalEvidenceBundle,
    purpose: '读取一条路径的关系和案例证据',
    access: 'read_only',
  },
  {
    name: MCP_TOOL_NAMES.compareKnowledgeCandidates,
    purpose: '对比采集候选与现有知识',
    access: 'read_only',
  },
  {
    name: MCP_TOOL_NAMES.prepareKnowledgeChanges,
    purpose: '生成受控、限时有效的入库方案',
    access: 'controlled_write',
  },
  {
    name: MCP_TOOL_NAMES.getImportPlanStatus,
    purpose: '读取入库方案状态',
    access: 'read_only',
  },
  {
    name: MCP_TOOL_NAMES.commitKnowledgeChanges,
    purpose: '提交用户已确认的入库方案',
    access: 'controlled_write',
  },
  { name: MCP_TOOL_NAMES.getImportResult, purpose: '读取成功入库结果', access: 'read_only' },
];

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
