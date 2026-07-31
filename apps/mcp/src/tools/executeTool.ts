import type { McpToolName } from '../capabilities/capabilityManifest.js';
import { CausalityApiClientError } from '../api/causalityApiClient.js';
import { normalizeToolError, toolErrorResult } from './toolError.js';

export interface ToolExecutionLogger {
  error(entry: Record<string, unknown>): void;
}

export const silentToolLogger: ToolExecutionLogger = {
  error: () => undefined,
};

interface ExecuteToolOptions {
  preserveWorkflowFields?: boolean;
}

export async function executeTool<T>(
  tool: McpToolName,
  logger: ToolExecutionLogger,
  action: () => Promise<T>,
  options: ExecuteToolOptions = {},
): Promise<T | ReturnType<typeof toolErrorResult>> {
  try {
    return await action();
  } catch (error) {
    const normalized = normalizeToolError(error);
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
        toolErrorCategory: normalized.category,
        retryable: normalized.retryable,
      });
    } else {
      logger.error({
        event: 'mcp_tool_failed',
        tool,
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
