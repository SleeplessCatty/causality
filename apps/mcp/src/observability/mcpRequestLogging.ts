import { AsyncLocalStorage } from 'node:async_hooks';

export interface McpLogger {
  info(entry: Record<string, unknown> | string): void;
  error(entry: Record<string, unknown> | string): void;
}

export interface McpOperationDescriptor {
  method: string;
  toolName?: string;
  promptName?: string;
  resourceUri?: string;
}

export interface McpRequestLogContext extends McpOperationDescriptor {
  requestId: string;
  transport: 'streamable-http' | 'stdio';
  clientName?: string;
  clientVersion?: string;
}

interface ActiveMcpRequest extends McpRequestLogContext {
  outcome: 'success' | 'business_error' | 'protocol_error' | 'system_error';
  errorCode?: string;
  retryable?: boolean;
}

const requestContext = new AsyncLocalStorage<ActiveMcpRequest>();

const fallbackLogger: McpLogger = {
  info: (entry) => console.info(entry),
  error: (entry) => console.error(entry),
};

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

export function describeMcpMessage(message: unknown): McpOperationDescriptor {
  const root = record(message);
  const method = typeof root?.method === 'string' ? root.method : 'unknown';
  const params = record(root?.params);
  if (method === 'tools/call' && typeof params?.name === 'string') {
    return { method, toolName: params.name };
  }
  if (method === 'prompts/get' && typeof params?.name === 'string') {
    return { method, promptName: params.name };
  }
  if (method === 'resources/read' && typeof params?.uri === 'string') {
    return { method, resourceUri: params.uri };
  }
  return { method };
}

function safeContext(context: McpRequestLogContext): Record<string, unknown> {
  return {
    requestId: context.requestId,
    transport: context.transport,
    method: context.method,
    ...(context.toolName === undefined ? {} : { toolName: context.toolName }),
    ...(context.promptName === undefined ? {} : { promptName: context.promptName }),
    ...(context.resourceUri === undefined ? {} : { resourceUri: context.resourceUri }),
    ...(context.clientName === undefined ? {} : { clientName: context.clientName }),
    ...(context.clientVersion === undefined ? {} : { clientVersion: context.clientVersion }),
  };
}

export function currentMcpRequestContext(): McpRequestLogContext | undefined {
  const active = requestContext.getStore();
  if (!active) return undefined;
  return {
    requestId: active.requestId,
    transport: active.transport,
    method: active.method,
    ...(active.toolName === undefined ? {} : { toolName: active.toolName }),
    ...(active.promptName === undefined ? {} : { promptName: active.promptName }),
    ...(active.resourceUri === undefined ? {} : { resourceUri: active.resourceUri }),
    ...(active.clientName === undefined ? {} : { clientName: active.clientName }),
    ...(active.clientVersion === undefined ? {} : { clientVersion: active.clientVersion }),
  };
}

export function markMcpRequestBusinessError(code: string, retryable: boolean): void {
  const active = requestContext.getStore();
  if (!active) return;
  active.outcome = 'business_error';
  active.errorCode = code;
  active.retryable = retryable;
}

export function markMcpRequestProtocolError(code: string): void {
  const active = requestContext.getStore();
  if (!active) return;
  active.outcome = 'protocol_error';
  active.errorCode = code;
}

export async function observeMcpRequest<T>(
  context: McpRequestLogContext,
  action: () => Promise<T> | T,
  logger: McpLogger = fallbackLogger,
): Promise<T> {
  const active: ActiveMcpRequest = { ...context, outcome: 'success' };
  const startedAt = performance.now();
  logger.info({ event: 'mcp_request_started', ...safeContext(context) });
  try {
    return await requestContext.run(active, action);
  } catch (error) {
    active.outcome = 'system_error';
    active.errorCode = 'MCP_REQUEST_FAILURE';
    throw error;
  } finally {
    const completion = {
      event: 'mcp_request_completed',
      ...safeContext(context),
      outcome: active.outcome,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      ...(active.errorCode === undefined ? {} : { errorCode: active.errorCode }),
      ...(active.retryable === undefined ? {} : { retryable: active.retryable }),
    };
    if (active.outcome === 'system_error') logger.error(completion);
    else logger.info(completion);
  }
}
