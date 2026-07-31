import {
  type AiCaptureCandidateSet,
  type AiCaptureComparison,
  type AiCaptureQualityReport,
  type AiImportCommitResult,
  type AiImportPlan,
  type AiImportPlanStatus,
  type PrepareAiImportPlanInput,
} from '@causality/contracts';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { MCP_TOOL_NAMES, toolRegistrationMetadata } from '../capabilities/capabilityManifest.js';
import {
  captureCandidateSetMcpSchema,
  captureComparisonMcpSchema,
  importCommitResultMcpSchema,
  importPlanMcpSchema,
  importPlanStatusMcpSchema,
  prepareImportPlanMcpSchema,
} from './captureMcpSchemas.js';
import { executeTool, silentToolLogger, type ToolExecutionLogger } from './executeTool.js';
import { textResult } from './toolResult.js';

export interface CausalityCaptureApi {
  compare(input: AiCaptureCandidateSet): Promise<AiCaptureComparison>;
  prepare(input: PrepareAiImportPlanInput): Promise<AiImportPlan>;
  planStatus(id: string): Promise<AiImportPlanStatus>;
  commit(id: string): Promise<AiImportCommitResult>;
  result(historyId: string): Promise<AiImportCommitResult>;
}

export type McpCaptureLogger = ToolExecutionLogger;

const planIdInputSchema = z.object({ planId: z.uuid().describe('不可变入库方案 ID') }).strict();
const historyIdInputSchema = z.object({ historyId: z.uuid().describe('AI 导入历史 ID') }).strict();

function candidateSetForApi(
  input: z.infer<typeof captureCandidateSetMcpSchema>,
): AiCaptureCandidateSet {
  return {
    topic: input.topic,
    clientName: input.clientName,
    atomicEvents: input.atomicEvents.map((event) => ({
      ...event,
      description: event.description ?? null,
    })),
    concreteCases: input.concreteCases,
    causalRelations: input.causalRelations.map((relation) => ({
      ...relation,
      description: relation.description ?? null,
    })),
    relationCaseLinks: input.relationCaseLinks,
  };
}

function preparePlanForApi(
  input: z.infer<typeof prepareImportPlanMcpSchema>,
): PrepareAiImportPlanInput {
  return {
    candidates: candidateSetForApi(input.candidates),
    comparison: {
      atomicEvents: input.comparison.atomicEvents.map((candidate) => ({
        ...candidate,
        matches: candidate.matches.map((match) => ({
          ...match,
          description: match.description ?? null,
        })),
      })),
      concreteCases: input.comparison.concreteCases,
      causalRelations: input.comparison.causalRelations.map((candidate) =>
        candidate.status === 'missing'
          ? candidate
          : {
              ...candidate,
              relation: {
                ...candidate.relation,
                description: candidate.relation.description ?? null,
              },
            },
      ),
      relationCaseLinks: input.comparison.relationCaseLinks,
      qualityReport: input.comparison.qualityReport,
    },
    decisions: input.decisions,
    ...(input.replacesPlanId === undefined ? {} : { replacesPlanId: input.replacesPlanId }),
  };
}

function comparisonText(comparison: AiCaptureComparison): string {
  return [
    '候选集合已经完成库内对比。',
    `- ${comparison.atomicEvents.length} 个原子事件`,
    `- ${comparison.concreteCases.length} 条具体案例`,
    `- ${comparison.causalRelations.length} 条因果关系`,
    `- ${comparison.relationCaseLinks.length} 条案例关联`,
    ...qualityText(comparison.qualityReport),
    '匹配结果只是候选依据，不会自动决定新增、复用或跳过。',
  ].join('\n');
}

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

function decisionLabel(
  decision:
    | AiImportPlan['decisions']['atomicEvents'][number]
    | AiImportPlan['decisions']['concreteCases'][number]
    | AiImportPlan['decisions']['causalRelations'][number],
): string {
  if (decision.action === 'create') return '新增';
  if (decision.action === 'reuse') return `复用（已有记录 ID: ${decision.existingId}）`;
  return `暂不入库（${decision.reason}）`;
}

function planText(plan: AiImportPlan): string {
  const eventLines = plan.decisions.atomicEvents.map(
    (decision) => `- ${decision.ref}：${decisionLabel(decision)}`,
  );
  const caseLines = plan.decisions.concreteCases.map(
    (decision) => `- ${decision.ref}：${decisionLabel(decision)}`,
  );
  const relationLines = plan.decisions.causalRelations.map(
    (decision) => `- ${decision.ref}：${decisionLabel(decision)}`,
  );
  const linkLines = plan.decisions.relationCaseLinks.map((decision) => {
    const label =
      decision.action === 'create'
        ? '新增关联'
        : decision.action === 'reuse'
          ? '复用已有关联'
          : `暂不入库（${decision.reason}）`;
    return `- ${decision.relationRef} + ${decision.caseRef}：${label}`;
  });
  const summary = plan.summary;

  return [
    `入库方案：${plan.topic}`,
    `方案编号：${plan.id}`,
    `方案版本：V${plan.version}`,
    `当前状态：${plan.status}`,
    `失效时间：${plan.expiresAt}`,
    ...qualityText(plan.comparison.qualityReport),
    '',
    '原子事件决策：',
    ...(eventLines.length > 0 ? eventLines : ['- 无']),
    '',
    '具体案例决策：',
    ...(caseLines.length > 0 ? caseLines : ['- 无']),
    '',
    '因果关系决策：',
    ...(relationLines.length > 0 ? relationLines : ['- 无']),
    '',
    '案例关联决策：',
    ...(linkLines.length > 0 ? linkLines : ['- 无']),
    '',
    '变更统计：',
    `- 新增/复用/更新原子事件：${summary.eventCreated}/${summary.eventReused}/${summary.eventUpdated}`,
    `- 新增/复用具体案例：${summary.caseCreated}/${summary.caseReused}`,
    `- 新增/复用因果关系：${summary.relationCreated}/${summary.relationReused}`,
    `- 新增/复用案例关联：${summary.relationCaseCreated}/${summary.relationCaseReused}`,
    `- 置信度变化：${summary.confidenceChanged}`,
    '',
    '只有用户明确确认这份最新完整方案后，才能提交入库。',
  ].join('\n');
}

function commitText(result: AiImportCommitResult): string {
  return [
    result.noChanges ? '入库事务已完成，本次没有业务数据变化。' : '入库事务已成功完成。',
    `方案编号：${result.planId}`,
    `历史编号：${result.historyId}`,
    `成功标记：${result.marker}`,
  ].join('\n');
}

export function registerCaptureTools(
  server: McpServer,
  apiClient: CausalityCaptureApi,
  logger: McpCaptureLogger = silentToolLogger,
): void {
  server.registerTool(
    MCP_TOOL_NAMES.compareKnowledgeCandidates,
    {
      ...toolRegistrationMetadata(MCP_TOOL_NAMES.compareKnowledgeCandidates),
      inputSchema: captureCandidateSetMcpSchema,
      outputSchema: captureComparisonMcpSchema,
    },
    (input) =>
      executeTool(
        MCP_TOOL_NAMES.compareKnowledgeCandidates,
        logger,
        async () => {
          // The transport schema owns the MCP wire shape. Cross-field validation belongs to the
          // API so clients receive its canonical structured quality report for repairable batches.
          const result = await apiClient.compare(candidateSetForApi(input));
          return textResult(comparisonText(result), { ...result });
        },
        { preserveWorkflowFields: true },
      ),
  );

  server.registerTool(
    MCP_TOOL_NAMES.prepareKnowledgeChanges,
    {
      ...toolRegistrationMetadata(MCP_TOOL_NAMES.prepareKnowledgeChanges),
      inputSchema: prepareImportPlanMcpSchema,
      outputSchema: importPlanMcpSchema,
    },
    (input) =>
      executeTool(
        MCP_TOOL_NAMES.prepareKnowledgeChanges,
        logger,
        async () => {
          // As with candidate comparison, the API owns canonical cross-field plan validation.
          const result = await apiClient.prepare(preparePlanForApi(input));
          return textResult(planText(result), { ...result });
        },
        { preserveWorkflowFields: true },
      ),
  );

  server.registerTool(
    MCP_TOOL_NAMES.getImportPlanStatus,
    {
      ...toolRegistrationMetadata(MCP_TOOL_NAMES.getImportPlanStatus),
      inputSchema: planIdInputSchema,
      outputSchema: importPlanStatusMcpSchema,
    },
    ({ planId }) =>
      executeTool(
        MCP_TOOL_NAMES.getImportPlanStatus,
        logger,
        async () => {
          const status = await apiClient.planStatus(planId);
          return textResult(`方案 ${planId} 当前状态：${status}`, { planId, status });
        },
        { preserveWorkflowFields: true },
      ),
  );

  server.registerTool(
    MCP_TOOL_NAMES.commitKnowledgeChanges,
    {
      ...toolRegistrationMetadata(MCP_TOOL_NAMES.commitKnowledgeChanges),
      inputSchema: planIdInputSchema,
      outputSchema: importCommitResultMcpSchema,
    },
    ({ planId }) =>
      executeTool(
        MCP_TOOL_NAMES.commitKnowledgeChanges,
        logger,
        async () => {
          const result = await apiClient.commit(planId);
          return textResult(commitText(result), { ...result });
        },
        { preserveWorkflowFields: true },
      ),
  );

  server.registerTool(
    MCP_TOOL_NAMES.getImportResult,
    {
      ...toolRegistrationMetadata(MCP_TOOL_NAMES.getImportResult),
      inputSchema: historyIdInputSchema,
      outputSchema: importCommitResultMcpSchema,
    },
    ({ historyId }) =>
      executeTool(
        MCP_TOOL_NAMES.getImportResult,
        logger,
        async () => {
          const result = await apiClient.result(historyId);
          return textResult(commitText(result), { ...result });
        },
        { preserveWorkflowFields: true },
      ),
  );
}
