import {
  aiCaptureCandidateSetInputSchema,
  aiCaptureComparisonSchema,
  aiCaptureQualityEntityTypeSchema,
  aiCaptureQualityIssueCodeSchema,
  aiImportBatchDetailSchema,
  aiImportBatchListResponseSchema,
  aiImportCommitResultSchema,
  aiImportPlanSchema,
  aiImportRecordListResponseSchema,
  aiImportRecordTypeSchema,
  aiWorkflowErrorSchema,
  apiErrorSchema,
  prepareAiImportPlanInputSchema,
  type AiCaptureComparison,
  type AiCaptureQualityEntityType,
  type AiCaptureQualityIssueCode,
  type AiCaptureQualityPhase,
  type AiImportBatchDetail,
  type AiImportBatchListResponse,
  type AiImportCommitResult,
  type AiImportPlan,
  type AiImportRecordListResponse,
  type AiImportRecordType,
  type AiWorkflowError,
  type ApiErrorCode,
  type PrepareAiImportPlanInput,
} from '@causality/contracts';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Pool } from 'pg';

import { PostgresAiCandidateComparisonRepository } from './aiCandidateComparisonRepository.js';
import { AiCandidateComparisonService } from './aiCandidateComparisonService.js';
import { AiCaptureDataError, AiCaptureQualityBlockedError } from './aiCaptureErrors.js';
import { AiCaptureQualityGate, buildQualityReport, toJsonPointer } from './aiCaptureQualityGate.js';
import { PostgresAiImportCommitRepository } from './aiImportCommitRepository.js';
import { AiImportCommitService } from './aiImportCommitService.js';
import { PostgresAiImportHistoryRepository } from './aiImportHistoryRepository.js';
import { PostgresAiImportPlanRepository } from './aiImportPlanRepository.js';
import { AiImportPlanService } from './aiImportPlanService.js';
import { AiSemanticCandidateService } from './aiSemanticCandidateService.js';
import { AiImportCommitError, qualityBlockedWorkflowError } from './aiWorkflowErrorClassifier.js';
import {
  PostgresSemanticQueryContextRepository,
  SemanticQueryError,
} from '../semantic/semanticQueryService.js';
import type { SemanticWorkerClient } from '../semantic/semanticWorkerClient.js';
import { PostgresMcpSettingsRepository } from '../mcp-settings/mcpSettingsRepository.js';

const AI_CAPTURE_BODY_LIMIT = 8 * 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const workflowErrorResponseSchema = z.union([apiErrorSchema, aiWorkflowErrorSchema]);

interface CandidateComparisonService {
  compare(input: unknown): Promise<AiCaptureComparison>;
}

interface ImportPlanService {
  prepare(input: PrepareAiImportPlanInput): Promise<AiImportPlan>;
  get(planId: string): Promise<AiImportPlan>;
}

interface ImportCommitService {
  commit(planId: string): Promise<AiImportCommitResult>;
}

interface ImportHistoryRepository {
  list(page: number): Promise<AiImportBatchListResponse>;
  findById(id: string): Promise<AiImportBatchDetail | null>;
  findResult(historyId: string): Promise<AiImportCommitResult | null>;
  listRecords(
    batchId: string,
    type: AiImportRecordType,
    page: number,
  ): Promise<AiImportRecordListResponse>;
}

interface McpTokenAuthorizer {
  authorize(token: string): Promise<boolean>;
}

export interface AiCaptureRouteDependencies {
  comparisonService: CandidateComparisonService;
  planService: ImportPlanService;
  commitService: ImportCommitService;
  historyRepository: ImportHistoryRepository;
  authorizer: McpTokenAuthorizer;
}

export interface AiCaptureRouteOptions {
  requestTimeoutMs?: number;
}

export function createAiCaptureRouteDependencies(
  pool: Pool,
  semanticWorkerClient: SemanticWorkerClient,
): AiCaptureRouteDependencies {
  const semanticCandidates = new AiSemanticCandidateService({
    contextRepository: new PostgresSemanticQueryContextRepository(pool),
    workerClient: semanticWorkerClient,
    pool,
  });
  const qualityGate = new AiCaptureQualityGate();
  return {
    comparisonService: new AiCandidateComparisonService(
      new PostgresAiCandidateComparisonRepository(pool),
      semanticCandidates,
      qualityGate,
    ),
    planService: new AiImportPlanService(
      new PostgresAiImportPlanRepository(pool),
      semanticCandidates,
      qualityGate,
    ),
    commitService: new AiImportCommitService(new PostgresAiImportCommitRepository(pool)),
    historyRepository: new PostgresAiImportHistoryRepository(pool),
    authorizer: new PostgresMcpSettingsRepository(pool),
  };
}

class AiCaptureRequestTimeoutError extends Error {
  public constructor() {
    super('AI capture request timed out');
    this.name = 'AiCaptureRequestTimeoutError';
  }
}

function sendError(
  reply: FastifyReply,
  status: 400 | 401 | 404 | 409 | 410 | 413 | 503,
  code: ApiErrorCode,
  message: string,
) {
  return reply.status(status).send({ code, message });
}

function workflowStatus(code: string): 400 | 404 | 409 | 410 {
  if (code === 'AI_PLAN_NOT_FOUND') return 404;
  if (code === 'AI_PLAN_EXPIRED') return 410;
  if (
    code === 'AI_EVENT_LIMIT_EXCEEDED' ||
    code === 'AI_CANDIDATE_DEPENDENCY_INVALID' ||
    code === 'AI_CANDIDATE_INVALID' ||
    code === 'AI_CANDIDATE_QUALITY_BLOCKED' ||
    code === 'AI_PLAN_QUALITY_BLOCKED' ||
    code === 'AI_PLAN_INPUT_INVALID' ||
    code === 'AI_PLAN_DECISIONS_INVALID' ||
    code === 'AI_PLAN_DEPENDENCY_SKIPPED'
  ) {
    return 400;
  }
  return 409;
}

function sendWorkflowError(error: unknown, reply: FastifyReply) {
  if (error instanceof AiCaptureRequestTimeoutError) {
    return reply.status(503).send({
      category: 'system',
      code: 'AI_REQUEST_TIMEOUT',
      message: 'AI 数据处理请求超时',
      affectedRefs: [],
      aiCanRepair: false,
      retryCurrentPlan: true,
      suggestedAction: '确认本地服务状态后由用户重新发起当前操作',
    } satisfies AiWorkflowError);
  }
  if (error instanceof SemanticQueryError) {
    const isSystem = error.code === 'SEMANTIC_WORKER_UNAVAILABLE';
    return reply.status(503).send({
      category: isSystem ? 'system' : 'configuration',
      code: error.code,
      message: error.message,
      affectedRefs: [],
      aiCanRepair: false,
      retryCurrentPlan: false,
      suggestedAction: isSystem
        ? '恢复语义 Worker 后重新执行候选对比'
        : '在参数配置中完成模型下载、加载和索引后重新执行候选对比',
    } satisfies AiWorkflowError);
  }
  if (error instanceof AiCaptureQualityBlockedError) {
    return reply.status(400).send(qualityBlockedWorkflowError(error));
  }
  if (error instanceof AiCaptureDataError) {
    return reply.status(workflowStatus(error.code)).send({
      category: 'data',
      code: error.code,
      message: error.message,
      affectedRefs: error.affectedRefs,
      aiCanRepair: true,
      retryCurrentPlan: false,
      suggestedAction: '根据当前数据库内容修正候选数据并重新生成完整入库方案',
    } satisfies AiWorkflowError);
  }
  if (error instanceof AiImportCommitError) {
    const workflow = error.workflowError;
    return reply
      .status(workflow.category === 'data' ? workflowStatus(workflow.code) : 503)
      .send(workflow);
  }
  throw error;
}

function assertPlanReadable(plan: AiImportPlan): void {
  if (plan.status === 'expired') {
    throw new AiCaptureDataError('AI_PLAN_EXPIRED', [plan.id], 'AI 入库方案已过期');
  }
  if (plan.status === 'replaced') {
    throw new AiCaptureDataError('AI_PLAN_NOT_LATEST', [plan.id], 'AI 入库方案已被新版本替代');
  }
  if (plan.status === 'invalidated') {
    throw new AiCaptureDataError(
      'AI_PLAN_DEPENDENCY_CHANGED',
      [plan.id],
      'AI 入库方案依赖的数据已经变化',
    );
  }
}

async function authorizeWorkflow(
  request: FastifyRequest,
  reply: FastifyReply,
  authorizer: McpTokenAuthorizer,
): Promise<boolean> {
  const raw = request.headers['x-causality-mcp-token'];
  const token = Array.isArray(raw) ? raw[0] : raw;
  if (!token || !(await authorizer.authorize(token))) {
    sendError(reply, 401, 'MCP_UNAUTHORIZED', 'MCP 访问令牌无效');
    return false;
  }
  return true;
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new AiCaptureRequestTimeoutError()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type ValidationDetail = {
  keyword?: unknown;
  instancePath?: unknown;
  message?: unknown;
  params?: {
    limit?: unknown;
    origin?: unknown;
    maximum?: unknown;
    params?: {
      qualityCode?: unknown;
      entityType?: unknown;
    };
    issue?: {
      path?: unknown;
      code?: unknown;
      origin?: unknown;
      maximum?: unknown;
      params?: {
        qualityCode?: unknown;
        entityType?: unknown;
      };
    };
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validationIssuePath(detail: ValidationDetail): readonly PropertyKey[] {
  const path = detail.params?.issue?.path;
  if (Array.isArray(path)) return path;
  if (typeof detail.instancePath !== 'string' || detail.instancePath.length === 0) return [];

  return detail.instancePath
    .replace(/^\//, '')
    .split('/')
    .map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~'))
    .map((token) => (/^(0|[1-9]\d*)$/.test(token) ? Number(token) : token));
}

function validationCustomParams(detail: ValidationDetail): {
  qualityCode?: unknown;
  entityType?: unknown;
} {
  return detail.params?.issue?.params ?? detail.params?.params ?? {};
}

function normalizedValidationPath(detail: ValidationDetail): string {
  const zodPath = validationIssuePath(detail);
  if (zodPath.length > 0) return toJsonPointer(zodPath);
  return '/';
}

function validationQualityCode(detail: ValidationDetail): AiCaptureQualityIssueCode {
  const issue = detail.params?.issue;
  const customCode = aiCaptureQualityIssueCodeSchema.safeParse(
    validationCustomParams(detail).qualityCode,
  );
  if (customCode.success) return customCode.data;

  return (issue?.code === 'too_big' || detail.keyword === 'too_big') &&
    (issue?.origin === 'array' || detail.params?.origin === 'array') &&
    (issue?.maximum === 50 || detail.params?.maximum === 50) &&
    validationIssuePath(detail).at(-1) === 'atomicEvents'
    ? 'AI_QUALITY_EVENT_LIMIT_EXCEEDED'
    : 'AI_QUALITY_SCHEMA_INVALID';
}

function validationSuggestedAction(code: AiCaptureQualityIssueCode): string {
  switch (code) {
    case 'AI_QUALITY_EVENT_LIMIT_EXCEEDED':
      return '保留主线数据并移除其余内容';
    case 'AI_QUALITY_DUPLICATE_REF':
      return '合并候选并保留一个稳定 ref';
    case 'AI_QUALITY_REFERENCE_MISSING':
      return '补齐引用或移除依赖项';
    case 'AI_QUALITY_SELF_LOOP':
      return '修正端点或移除关系';
    case 'AI_QUALITY_DUPLICATE_LINK':
      return '合并重复关联';
    default:
      return '按字段路径修正参数';
  }
}

function validationRefs(raw: unknown, detail: ValidationDetail): string[] {
  const path = validationIssuePath(detail);
  const sectionIndex = path.findIndex(
    (part) =>
      part === 'atomicEvents' ||
      part === 'concreteCases' ||
      part === 'causalRelations' ||
      part === 'relationCaseLinks',
  );
  const candidateIndex = path[sectionIndex + 1];
  if (sectionIndex < 0 || typeof candidateIndex !== 'number') return [];

  let value = raw;
  for (const part of path.slice(0, sectionIndex + 2)) {
    if (typeof part === 'number') {
      if (!Array.isArray(value)) return [];
      value = value[part];
    } else {
      if (!isRecord(value)) return [];
      value = value[String(part)];
    }
  }
  if (!isRecord(value)) return [];

  if (path[sectionIndex] === 'relationCaseLinks') {
    return [value.relationRef, value.caseRef].filter(
      (ref): ref is string => typeof ref === 'string',
    );
  }
  return typeof value.ref === 'string' ? [value.ref] : [];
}

function validationEntityType(path: string): AiCaptureQualityEntityType {
  const tokens = path.split('/').slice(1);
  if (tokens.includes('atomicEvents')) return 'event';
  if (tokens.includes('concreteCases')) return 'case';
  if (tokens.includes('causalRelations')) return 'relation';
  if (tokens.includes('relationCaseLinks')) return 'link';
  return 'batch';
}

function validationQualityError(
  validation: readonly ValidationDetail[],
  phase: AiCaptureQualityPhase,
  raw: unknown,
): AiCaptureQualityBlockedError {
  const report = buildQualityReport(
    validation.map((detail) => {
      const path = normalizedValidationPath(detail);
      const code = validationQualityCode(detail);
      const customEntityType = aiCaptureQualityEntityTypeSchema.safeParse(
        validationCustomParams(detail).entityType,
      );
      return {
        code,
        severity: 'error' as const,
        phase,
        entityType:
          code === 'AI_QUALITY_EVENT_LIMIT_EXCEEDED'
            ? 'batch'
            : customEntityType.success
              ? customEntityType.data
              : validationEntityType(path),
        refs: validationRefs(raw, detail),
        paths: [path],
        message: typeof detail.message === 'string' ? detail.message : '请求参数不合法',
        suggestedAction: validationSuggestedAction(code),
        aiCanRepair: true,
      };
    }),
  );

  return new AiCaptureQualityBlockedError(
    phase === 'candidate' ? 'AI_CANDIDATE_QUALITY_BLOCKED' : 'AI_PLAN_QUALITY_BLOCKED',
    report,
  );
}

function routeParserError(
  error: FastifyError,
  reply: FastifyReply,
  phase?: AiCaptureQualityPhase,
  raw?: unknown,
): FastifyReply {
  if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
    return sendError(reply, 413, 'REQUEST_BODY_TOO_LARGE', '请求内容不能超过 8 MiB');
  }
  if (error.validation && phase) {
    return sendWorkflowError(
      validationQualityError(error.validation as ValidationDetail[], phase, raw),
      reply,
    );
  }
  if (error.validation) {
    return sendError(reply, 400, 'VALIDATION_ERROR', '请求参数不合法');
  }
  if (error.statusCode === 400 && error.code.startsWith('FST_ERR_CTP_')) {
    return sendError(reply, 400, 'VALIDATION_ERROR', '请求 JSON 格式不合法');
  }
  throw error;
}

export function registerAiCaptureRoutes(
  app: FastifyInstance,
  dependencies: AiCaptureRouteDependencies,
  options: AiCaptureRouteOptions = {},
): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  routes.setValidatorCompiler(validatorCompiler);
  routes.setSerializerCompiler(serializerCompiler);
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const planParamsSchema = z.object({ planId: z.uuid() }).strict();
  const historyParamsSchema = z.object({ historyId: z.uuid() }).strict();
  const batchParamsSchema = z.object({ batchId: z.uuid() }).strict();
  const pageQuerySchema = z.object({ page: z.coerce.number().int().min(1).default(1) }).strict();
  const recordsQuerySchema = pageQuerySchema.extend({ type: aiImportRecordTypeSchema }).strict();
  const candidateParserErrorHandler = (
    error: FastifyError,
    request: FastifyRequest,
    reply: FastifyReply,
  ) => routeParserError(error, reply, 'candidate', request.body);
  const planParserErrorHandler = (
    error: FastifyError,
    request: FastifyRequest,
    reply: FastifyReply,
  ) => routeParserError(error, reply, 'plan', request.body);
  const workflowAuth = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await authorizeWorkflow(request, reply, dependencies.authorizer))) return reply;
  };

  routes.post(
    '/api/ai-captures/compare',
    {
      bodyLimit: AI_CAPTURE_BODY_LIMIT,
      errorHandler: candidateParserErrorHandler,
      preValidation: workflowAuth,
      schema: {
        tags: ['ai-captures'],
        body: aiCaptureCandidateSetInputSchema,
        response: {
          200: aiCaptureComparisonSchema,
          400: workflowErrorResponseSchema,
          401: apiErrorSchema,
          413: apiErrorSchema,
          503: workflowErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return await withTimeout(dependencies.comparisonService.compare(request.body), timeoutMs);
      } catch (error) {
        return sendWorkflowError(error, reply);
      }
    },
  );

  routes.post(
    '/api/ai-captures/plans',
    {
      bodyLimit: AI_CAPTURE_BODY_LIMIT,
      errorHandler: planParserErrorHandler,
      preValidation: workflowAuth,
      schema: {
        tags: ['ai-captures'],
        body: prepareAiImportPlanInputSchema,
        response: {
          201: aiImportPlanSchema,
          400: workflowErrorResponseSchema,
          401: apiErrorSchema,
          409: workflowErrorResponseSchema,
          413: apiErrorSchema,
          503: workflowErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const plan = await withTimeout(dependencies.planService.prepare(request.body), timeoutMs);
        return reply.status(201).send(plan);
      } catch (error) {
        return sendWorkflowError(error, reply);
      }
    },
  );

  routes.get(
    '/api/ai-captures/plans/:planId',
    {
      preValidation: workflowAuth,
      schema: {
        tags: ['ai-captures'],
        params: planParamsSchema,
        response: {
          200: aiImportPlanSchema,
          400: workflowErrorResponseSchema,
          401: apiErrorSchema,
          404: workflowErrorResponseSchema,
          409: workflowErrorResponseSchema,
          410: workflowErrorResponseSchema,
          503: workflowErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const plan = await dependencies.planService.get(request.params.planId);
        assertPlanReadable(plan);
        return plan;
      } catch (error) {
        return sendWorkflowError(error, reply);
      }
    },
  );

  routes.post(
    '/api/ai-captures/plans/:planId/commit',
    {
      preValidation: workflowAuth,
      schema: {
        tags: ['ai-captures'],
        params: planParamsSchema,
        response: {
          200: aiImportCommitResultSchema,
          400: workflowErrorResponseSchema,
          401: apiErrorSchema,
          404: workflowErrorResponseSchema,
          409: workflowErrorResponseSchema,
          410: workflowErrorResponseSchema,
          503: workflowErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return await dependencies.commitService.commit(request.params.planId);
      } catch (error) {
        return sendWorkflowError(error, reply);
      }
    },
  );

  routes.get(
    '/api/ai-captures/results/:historyId',
    {
      preValidation: workflowAuth,
      schema: {
        tags: ['ai-captures'],
        params: historyParamsSchema,
        response: {
          200: aiImportCommitResultSchema,
          400: apiErrorSchema,
          401: apiErrorSchema,
          404: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await dependencies.historyRepository.findResult(request.params.historyId);
      return result ?? sendError(reply, 404, 'AI_HISTORY_NOT_FOUND', 'AI 导入结果不存在');
    },
  );

  routes.get(
    '/api/ai-captures/history',
    {
      schema: {
        tags: ['ai-captures'],
        querystring: pageQuerySchema,
        response: {
          200: aiImportBatchListResponseSchema,
          400: apiErrorSchema,
        },
      },
    },
    async (request) => dependencies.historyRepository.list(request.query.page),
  );

  routes.get(
    '/api/ai-captures/history/:batchId',
    {
      schema: {
        tags: ['ai-captures'],
        params: batchParamsSchema,
        response: {
          200: aiImportBatchDetailSchema,
          400: apiErrorSchema,
          404: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await dependencies.historyRepository.findById(request.params.batchId);
      return result ?? sendError(reply, 404, 'AI_HISTORY_NOT_FOUND', 'AI 导入历史不存在');
    },
  );

  routes.get(
    '/api/ai-captures/history/:batchId/records',
    {
      schema: {
        tags: ['ai-captures'],
        params: batchParamsSchema,
        querystring: recordsQuerySchema,
        response: {
          200: aiImportRecordListResponseSchema,
          400: apiErrorSchema,
        },
      },
    },
    async (request) =>
      dependencies.historyRepository.listRecords(
        request.params.batchId,
        request.query.type,
        request.query.page,
      ),
  );
}
