import type { AiCaptureQualityReport, AiWorkflowError } from '@causality/contracts';
import { z } from 'zod';

import { CausalityApiClientError } from '../api/causalityApiClient.js';

export type McpToolErrorCategory =
  'validation' | 'not_found' | 'conflict' | 'stale_state' | 'unavailable' | 'internal';

export interface McpToolError {
  code: string;
  category: McpToolErrorCategory;
  message: string;
  retryable: boolean;
  suggestedAction: string;
  details: {
    traceId?: string;
    status?: number;
    affectedRefCount?: number;
    qualityIssueCount?: number;
  };
}

export interface McpToolErrorStructuredContent {
  error: McpToolError;
}

export const mcpToolErrorSchema = z
  .object({
    code: z.string().min(1),
    category: z.enum([
      'validation',
      'not_found',
      'conflict',
      'stale_state',
      'unavailable',
      'internal',
    ]),
    message: z.string().min(1),
    retryable: z.boolean(),
    suggestedAction: z.string().min(1),
    details: z
      .object({
        traceId: z.string().optional(),
        status: z.number().int().optional(),
        affectedRefCount: z.number().int().nonnegative().optional(),
        qualityIssueCount: z.number().int().nonnegative().optional(),
      })
      .strict(),
  })
  .strict();

/**
 * SDK clients validate structured errors against the advertised output Schema. Keep an
 * object-shaped compatibility Schema so it remains visible in tools/list, while the server-side
 * refinement still requires the complete success shape whenever `error` is absent.
 */
export function toolOutputSchema<T extends z.ZodObject>(successSchema: T) {
  const successErrorSchema = successSchema.shape.error as z.ZodType | undefined;
  return z
    .object(successSchema.shape)
    .partial()
    .extend({
      error:
        successErrorSchema === undefined
          ? mcpToolErrorSchema.optional()
          : z.union([successErrorSchema, mcpToolErrorSchema]).optional(),
      category: z.enum(['data', 'system', 'configuration']).optional(),
      code: z.string().optional(),
      message: z.string().optional(),
      affectedRefs: z.array(z.string()).optional(),
      aiCanRepair: z.boolean().optional(),
      retryCurrentPlan: z.boolean().optional(),
      suggestedAction: z.string().optional(),
      qualityReport: z.unknown().optional(),
    })
    .strict()
    .superRefine((value, context) => {
      if (value.error !== undefined) return;
      if (!successSchema.safeParse(value).success) {
        context.addIssue({
          code: 'custom',
          message: 'Tool success output does not match its complete output Schema',
        });
      }
    });
}

interface ToolErrorResultOptions {
  preserveWorkflowFields?: boolean;
}

const staleCodes = new Set([
  'AI_PLAN_COMPARISON_STALE',
  'AI_PLAN_EXPIRED',
  'AI_PLAN_NOT_LATEST',
  'AI_PLAN_DEPENDENCY_CHANGED',
]);

function classify(error: CausalityApiClientError): McpToolErrorCategory {
  if (staleCodes.has(error.code)) return 'stale_state';
  if (error.status === 404) return 'not_found';
  if (error.status === 409) return 'conflict';
  if (error.status === 400 || error.status === 422) return 'validation';
  if (
    error.kind === 'configuration' ||
    error.status === 502 ||
    error.status === 503 ||
    error.status === 504 ||
    error.code === 'API_UNAVAILABLE' ||
    error.code === 'API_REQUEST_ABORTED'
  ) {
    return 'unavailable';
  }
  return 'internal';
}

function defaultSuggestedAction(category: McpToolErrorCategory): string {
  if (category === 'validation') return '修正请求参数或候选数据后重新执行';
  if (category === 'not_found') return '重新查询并使用仍然存在的记录 ID';
  if (category === 'conflict') return '重新读取当前数据后调整操作';
  if (category === 'stale_state') return '重新查询并生成完整方案';
  if (category === 'unavailable') return '检查 MCP 与 Causality API 配置后重新执行';
  return '检查 MCP 服务日志和 Causality 服务状态后由用户重新发起操作';
}

export function normalizeToolError(error: unknown): McpToolError {
  if (!(error instanceof CausalityApiClientError)) {
    return {
      code: 'MCP_TOOL_FAILURE',
      category: 'internal',
      message: 'MCP 工具执行失败',
      retryable: false,
      suggestedAction: defaultSuggestedAction('internal'),
      details: {},
    };
  }

  const category = classify(error);
  const retryable =
    category === 'unavailable' &&
    error.kind !== 'configuration' &&
    error.code !== 'MCP_TOKEN_MISSING';
  return {
    code: error.code,
    category,
    message: error.message,
    retryable,
    suggestedAction: error.suggestedAction ?? defaultSuggestedAction(category),
    details: {
      ...(error.traceId === undefined ? {} : { traceId: error.traceId }),
      ...(error.status === undefined ? {} : { status: error.status }),
      ...(error.affectedRefs.length === 0 ? {} : { affectedRefCount: error.affectedRefs.length }),
      ...(error.qualityReport === undefined
        ? {}
        : { qualityIssueCount: error.qualityReport.issues.length }),
    },
  };
}

function workflowError(error: unknown): AiWorkflowError {
  if (error instanceof CausalityApiClientError) {
    const category =
      error.category ??
      (error.kind === 'configuration' || (error.kind === 'api' && error.status === 401)
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
      ...(error.qualityReport === undefined ? {} : { qualityReport: error.qualityReport }),
    };
  }
  return {
    category: 'system',
    code: 'MCP_TOOL_FAILURE',
    message: 'MCP 工具执行失败',
    affectedRefs: [],
    aiCanRepair: false,
    retryCurrentPlan: false,
    suggestedAction: defaultSuggestedAction('internal'),
  };
}

function qualityFailureText(report: AiCaptureQualityReport): string[] {
  const errors = report.issues.filter((issue) => issue.severity === 'error');
  const warnings = report.issues.filter((issue) => issue.severity === 'warning');
  return [
    `质量检查：${report.status === 'passed' ? '通过' : report.status === 'warning' ? '存疑' : '阻断'}`,
    `- 阻断问题：${errors.length}`,
    `- 存疑问题：${warnings.length}`,
    ...report.issues.map(
      (issue) =>
        `- [${issue.code}] ${issue.message}；路径：${issue.paths.join('、') || '批次'}；相关项：${issue.refs.join('、') || '批次'}；建议：${issue.suggestedAction}`,
    ),
  ];
}

export function toolErrorResult(error: unknown, options: ToolErrorResultOptions = {}) {
  const normalized = normalizeToolError(error);
  const legacy = options.preserveWorkflowFields ? workflowError(error) : undefined;
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: [
          `操作失败：${normalized.message}`,
          `错误代码：${normalized.code}`,
          `建议动作：${normalized.suggestedAction}`,
          ...(legacy?.qualityReport === undefined ? [] : qualityFailureText(legacy.qualityReport)),
        ].join('\n'),
      },
    ],
    structuredContent: {
      ...(legacy ?? {}),
      error: normalized,
    },
  };
}
