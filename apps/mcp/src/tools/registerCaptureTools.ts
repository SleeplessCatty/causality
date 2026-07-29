import {
  aiCaptureCandidateSetInputSchema,
  prepareAiImportPlanInputSchema,
  type AiCaptureCandidateSet,
  type AiCaptureComparison,
  type AiImportCommitResult,
  type AiImportPlan,
  type AiImportPlanStatus,
  type AiWorkflowError,
  type PrepareAiImportPlanInput,
} from '@causality/contracts';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { CausalityApiClientError } from '../api/causalityApiClient.js';
import {
  captureCandidateSetMcpSchema,
  captureComparisonMcpSchema,
  importCommitResultMcpSchema,
  importPlanMcpSchema,
  importPlanStatusMcpSchema,
  prepareImportPlanMcpSchema,
} from './captureMcpSchemas.js';

export interface CausalityCaptureApi {
  compare(input: AiCaptureCandidateSet): Promise<AiCaptureComparison>;
  prepare(input: PrepareAiImportPlanInput): Promise<AiImportPlan>;
  planStatus(id: string): Promise<AiImportPlanStatus>;
  commit(id: string): Promise<AiImportCommitResult>;
  result(historyId: string): Promise<AiImportCommitResult>;
}

export interface McpCaptureLogger {
  error(entry: Record<string, unknown>): void;
}

const silentLogger: McpCaptureLogger = {
  error: () => undefined,
};

const annotations = {
  compare_knowledge_candidates: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  prepare_knowledge_changes: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  get_import_plan_status: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  commit_knowledge_changes: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  get_import_result: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const;

const planIdInputSchema = z.object({ planId: z.uuid().describe('不可变入库方案 ID') }).strict();
const historyIdInputSchema = z.object({ historyId: z.uuid().describe('AI 导入历史 ID') }).strict();
function textResult(text: string, structuredContent: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text }],
    structuredContent,
  };
}

function comparisonText(comparison: AiCaptureComparison): string {
  return [
    '候选集合已经完成库内对比。',
    `- ${comparison.atomicEvents.length} 个原子事件`,
    `- ${comparison.concreteCases.length} 条具体案例`,
    `- ${comparison.causalRelations.length} 条因果关系`,
    `- ${comparison.relationCaseLinks.length} 条案例关联`,
    '匹配结果只是候选依据，不会自动决定新增、复用或跳过。',
  ].join('\n');
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

function workflowError(error: unknown): AiWorkflowError {
  if (error instanceof CausalityApiClientError) {
    const category =
      error.category ??
      (error.kind === 'configuration'
        ? 'configuration'
        : error.kind === 'api' && error.status === 401
          ? 'configuration'
          : 'system');
    return {
      category,
      code: error.code,
      message: error.message,
      affectedRefs: error.affectedRefs,
      aiCanRepair: error.aiCanRepair ?? false,
      retryCurrentPlan: error.retryCurrentPlan ?? false,
      suggestedAction:
        error.suggestedAction ??
        (category === 'configuration'
          ? '检查 MCP 与 Causality API 配置后重新执行'
          : '检查 Causality 服务状态后等待用户决定是否重试'),
    };
  }
  return {
    category: 'system',
    code: 'MCP_TOOL_FAILURE',
    message: 'MCP 工具执行失败',
    affectedRefs: [],
    aiCanRepair: false,
    retryCurrentPlan: false,
    suggestedAction: '检查 MCP 服务日志和 Causality 服务状态后由用户重新发起操作',
  };
}

function errorResult(error: unknown) {
  const structuredContent = workflowError(error);
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: [
          `操作失败：${structuredContent.message}`,
          `错误代码：${structuredContent.code}`,
          `建议动作：${structuredContent.suggestedAction}`,
        ].join('\n'),
      },
    ],
    structuredContent,
  };
}

function logToolFailure(logger: McpCaptureLogger, tool: string, error: unknown): void {
  if (error instanceof CausalityApiClientError) {
    logger.error({
      event: 'mcp_tool_failed',
      tool,
      errorKind: error.kind,
      errorCode: error.code,
      httpStatus: error.status ?? null,
      traceId: error.traceId ?? null,
      category: error.category ?? null,
      aiCanRepair: error.aiCanRepair ?? null,
      retryCurrentPlan: error.retryCurrentPlan ?? null,
    });
    return;
  }
  logger.error({
    event: 'mcp_tool_failed',
    tool,
    errorKind: 'unexpected',
    errorCode: 'MCP_TOOL_FAILURE',
    errorName: error instanceof Error ? error.name : 'UnknownError',
  });
}

export function registerCaptureTools(
  server: McpServer,
  apiClient: CausalityCaptureApi,
  logger: McpCaptureLogger = silentLogger,
): void {
  server.registerTool(
    'compare_knowledge_candidates',
    {
      title: '对比知识候选',
      description: '一次性对比完整的原子事件、具体案例、因果关系和案例关联候选集合。',
      inputSchema: captureCandidateSetMcpSchema,
      outputSchema: captureComparisonMcpSchema,
      annotations: annotations.compare_knowledge_candidates,
    },
    async (input) => {
      try {
        const result = await apiClient.compare(aiCaptureCandidateSetInputSchema.parse(input));
        return textResult(comparisonText(result), { ...result });
      } catch (error) {
        logToolFailure(logger, 'compare_knowledge_candidates', error);
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'prepare_knowledge_changes',
    {
      title: '生成入库方案',
      description: '根据完整候选、对比结果和 AI 决策生成不可变且限时有效的完整入库方案。',
      inputSchema: prepareImportPlanMcpSchema,
      outputSchema: importPlanMcpSchema,
      annotations: annotations.prepare_knowledge_changes,
    },
    async (input) => {
      try {
        const result = await apiClient.prepare(prepareAiImportPlanInputSchema.parse(input));
        return textResult(planText(result), { ...result });
      } catch (error) {
        logToolFailure(logger, 'prepare_knowledge_changes', error);
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'get_import_plan_status',
    {
      title: '查询入库方案状态',
      description: '查询一个不可变入库方案当前是否仍然有效、可提交或已经进入终态。',
      inputSchema: planIdInputSchema,
      outputSchema: importPlanStatusMcpSchema,
      annotations: annotations.get_import_plan_status,
    },
    async ({ planId }) => {
      try {
        const status = await apiClient.planStatus(planId);
        return textResult(`方案 ${planId} 当前状态：${status}`, { planId, status });
      } catch (error) {
        logToolFailure(logger, 'get_import_plan_status', error);
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'commit_knowledge_changes',
    {
      title: '确认执行入库方案',
      description: '仅在用户明确确认最新完整方案后，按不可变方案 ID 执行一次幂等事务入库。',
      inputSchema: planIdInputSchema,
      outputSchema: importCommitResultMcpSchema,
      annotations: annotations.commit_knowledge_changes,
    },
    async ({ planId }) => {
      try {
        const result = await apiClient.commit(planId);
        return textResult(commitText(result), { ...result });
      } catch (error) {
        logToolFailure(logger, 'commit_knowledge_changes', error);
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'get_import_result',
    {
      title: '查询入库结果',
      description: '按成功历史 ID 查询已完成事务的幂等入库结果和采集标记。',
      inputSchema: historyIdInputSchema,
      outputSchema: importCommitResultMcpSchema,
      annotations: annotations.get_import_result,
    },
    async ({ historyId }) => {
      try {
        const result = await apiClient.result(historyId);
        return textResult(commitText(result), { ...result });
      } catch (error) {
        logToolFailure(logger, 'get_import_result', error);
        return errorResult(error);
      }
    },
  );
}
