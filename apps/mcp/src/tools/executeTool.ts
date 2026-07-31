import type { McpToolName } from '../capabilities/capabilityManifest.js';
import { CausalityApiClientError } from '../api/causalityApiClient.js';
import {
  currentMcpRequestContext,
  markMcpRequestBusinessError,
  type McpLogger,
} from '../observability/mcpRequestLogging.js';
import { normalizeToolError, toolErrorResult } from './toolError.js';

export type ToolExecutionLogger = McpLogger;

export const silentToolLogger: ToolExecutionLogger = {
  info: () => undefined,
  error: () => undefined,
};

export interface ToolExecutionSummary<T> {
  inputCounts?: Record<string, number>;
  outputCounts?: (result: T) => Record<string, number>;
}

interface ExecuteToolOptions<T> extends ToolExecutionSummary<T> {
  preserveWorkflowFields?: boolean;
}

export async function executeTool<T>(
  tool: McpToolName,
  logger: ToolExecutionLogger,
  action: () => Promise<T>,
  options: ExecuteToolOptions<T> = {},
): Promise<T | ReturnType<typeof toolErrorResult>> {
  const startedAt = performance.now();
  const context = currentMcpRequestContext();
  const correlation =
    context === undefined
      ? {}
      : {
          requestId: context.requestId,
          transport: context.transport,
          ...(context.clientName === undefined ? {} : { clientName: context.clientName }),
          ...(context.clientVersion === undefined ? {} : { clientVersion: context.clientVersion }),
        };
  try {
    const result = await action();
    logger.info({
      event: 'mcp_tool_completed',
      tool,
      ...correlation,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      ...(options.inputCounts ?? {}),
      ...(options.outputCounts?.(result) ?? {}),
    });
    return result;
  } catch (error) {
    const normalized = normalizeToolError(error);
    markMcpRequestBusinessError(normalized.code, normalized.retryable);
    if (error instanceof CausalityApiClientError) {
      logger.error({
        event: 'mcp_tool_failed',
        tool,
        ...correlation,
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
        errorKind: error.kind,
        errorCode: error.code,
        httpStatus: error.status ?? null,
        traceId: error.traceId ?? null,
        category: error.category ?? null,
        aiCanRepair: error.aiCanRepair ?? null,
        retryCurrentPlan: error.retryCurrentPlan ?? null,
        toolErrorCategory: normalized.category,
        retryable: normalized.retryable,
      });
    } else {
      logger.error({
        event: 'mcp_tool_failed',
        tool,
        ...correlation,
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
        errorKind: 'unexpected',
        errorCode: normalized.code,
        errorName: error instanceof Error ? error.name : 'UnknownError',
        toolErrorCategory: normalized.category,
        retryable: normalized.retryable,
      });
    }
    return toolErrorResult(error, options);
  }
}
