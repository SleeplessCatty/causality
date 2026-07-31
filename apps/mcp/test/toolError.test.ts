import { describe, expect, it } from 'vitest';

import { CausalityApiClientError } from '../src/api/causalityApiClient.js';
import { toolErrorResult } from '../src/tools/toolError.js';

function apiError(
  code: string,
  status: number,
  options: { kind?: 'api' | 'configuration' | 'contract' | 'system' } = {},
) {
  return new CausalityApiClientError({
    kind: options.kind ?? 'api',
    code,
    message: `failure: ${code}`,
    status,
    traceId: 'trace-1',
  });
}

describe('MCP Tool errors', () => {
  it.each([
    [apiError('VALIDATION_ERROR', 400), 'validation', false],
    [apiError('EVENT_NOT_FOUND', 404), 'not_found', false],
    [apiError('RELATION_CONFLICT', 409), 'conflict', false],
    [apiError('AI_PLAN_COMPARISON_STALE', 409), 'stale_state', false],
    [apiError('API_UNAVAILABLE', 503, { kind: 'system' }), 'unavailable', true],
    [apiError('INVALID_API_RESPONSE', 200, { kind: 'contract' }), 'internal', false],
  ] as const)('maps %s to %s', (error, category, retryable) => {
    expect(toolErrorResult(error)).toMatchObject({
      isError: true,
      structuredContent: {
        error: {
          code: error.code,
          category,
          message: error.message,
          retryable,
          suggestedAction: expect.any(String),
          details: { traceId: 'trace-1', status: error.status },
        },
      },
    });
  });

  it('keeps a missing local credential unavailable but not blindly retryable', () => {
    const result = toolErrorResult(
      new CausalityApiClientError({
        kind: 'configuration',
        code: 'MCP_TOKEN_MISSING',
        message: 'MCP 访问令牌尚未配置',
      }),
    );

    expect(result.structuredContent).toMatchObject({
      error: {
        category: 'unavailable',
        retryable: false,
        suggestedAction: '检查 MCP 与 Causality API 配置后重新执行',
      },
    });
  });

  it('does not serialize causes, stacks, credentials, SQL, or complete payloads', () => {
    const secret = 'Bearer ' + 'a'.repeat(64);
    const result = toolErrorResult(
      new CausalityApiClientError({
        kind: 'system',
        code: 'API_UNAVAILABLE',
        message: '无法连接 Causality API',
        cause: new Error(`${secret} select * from abstract_events private-payload`),
      }),
    );
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('select *');
    expect(serialized).not.toContain('private-payload');
    expect(serialized).not.toContain('stack');
    expect(serialized).not.toContain('cause');
  });
});
