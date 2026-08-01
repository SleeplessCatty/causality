import { randomUUID } from 'node:crypto';

import {
  aiCaptureComparisonSchema,
  aiImportCommitResultSchema,
  aiImportPlanSchema,
  aiWorkflowErrorSchema,
  apiErrorSchema,
  causalEvidenceBundleResponseSchema,
  causalPathResponseSchema,
  caseDetailSchema,
  caseListResponseSchema,
  caseRelationListResponseSchema,
  causalGraphResponseSchema,
  eventDetailSchema,
  eventListResponseSchema,
  eventRelationListResponseSchema,
  healthResponseSchema,
  readinessResponseSchema,
  relationCaseListResponseSchema,
  relationDetailSchema,
  relationListResponseSchema,
  semanticLifecycleSnapshotSchema,
  type AiCaptureCandidateSet,
  type AiCaptureComparison,
  type AiCaptureQualityReport,
  type AiImportCommitResult,
  type AiImportPlan,
  type AiImportPlanStatus,
  type AiWorkflowError,
  type CausalEvidenceBundleInput,
  type CausalEvidenceBundleResponse,
  type CaseDetail,
  type CaseListResponse,
  type CaseRelationListResponse,
  type CausalGraphQuery,
  type CausalGraphResponse,
  type CausalPathQuery,
  type CausalPathResponse,
  type EventDetail,
  type EventListResponse,
  type EventRelationListResponse,
  type HealthResponse,
  type PrepareAiImportPlanInput,
  type ReadinessResponse,
  type RelationCaseListResponse,
  type RelationDetail,
  type RelationListResponse,
  type SearchMode,
  type SemanticLifecycleSnapshot,
} from '@causality/contracts';
import type { z } from 'zod';

export type CausalityApiClientErrorKind = 'api' | 'configuration' | 'contract' | 'system';

interface CausalityApiClientErrorOptions {
  kind: CausalityApiClientErrorKind;
  code: string;
  message: string;
  status?: number;
  traceId?: string;
  workflowError?: AiWorkflowError;
  qualityReport?: AiCaptureQualityReport;
  cause?: unknown;
}

export class CausalityApiClientError extends Error {
  public readonly kind: CausalityApiClientErrorKind;
  public readonly code: string;
  public readonly status: number | undefined;
  public readonly traceId: string | undefined;
  public readonly category: AiWorkflowError['category'] | undefined;
  public readonly affectedRefs: string[];
  public readonly aiCanRepair: boolean | undefined;
  public readonly retryCurrentPlan: boolean | undefined;
  public readonly suggestedAction: string | undefined;
  public readonly qualityReport: AiCaptureQualityReport | undefined;

  public constructor(options: CausalityApiClientErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'CausalityApiClientError';
    this.kind = options.kind;
    this.code = options.code;
    this.status = options.status;
    this.traceId = options.traceId;
    this.category = options.workflowError?.category;
    this.affectedRefs = options.workflowError?.affectedRefs ?? [];
    this.aiCanRepair = options.workflowError?.aiCanRepair;
    this.retryCurrentPlan = options.workflowError?.retryCurrentPlan;
    this.suggestedAction = options.workflowError?.suggestedAction;
    this.qualityReport = options.qualityReport ?? options.workflowError?.qualityReport;
  }
}

export interface CausalityApiClientOptions {
  baseUrl: string;
  token: string;
  internalSecret: string;
  pathPrefix: '/internal/mcp';
  clientName?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

interface RequestOptions<T> {
  schema: z.ZodType<T>;
  query?: Record<string, string | number | undefined>;
  method?: 'GET' | 'POST';
  body?: unknown;
  timeoutMs?: number;
  acceptedStatuses?: readonly number[];
}

const DEFAULT_TIMEOUT_MS = 35_000;
const DEFAULT_RELATION_PAGE_SIZE = 20;
const STATUS_TIMEOUT_MS = 5_000;

function apiFailure(status: number, payload: unknown, traceId: string): CausalityApiClientError {
  const workflow = aiWorkflowErrorSchema.safeParse(payload);
  if (workflow.success) {
    return new CausalityApiClientError({
      kind: 'api',
      status,
      traceId,
      code: workflow.data.code,
      message: workflow.data.message,
      workflowError: workflow.data,
      ...(workflow.data.qualityReport === undefined
        ? {}
        : { qualityReport: workflow.data.qualityReport }),
    });
  }

  const api = apiErrorSchema.safeParse(payload);
  if (api.success) {
    return new CausalityApiClientError({
      kind: 'api',
      status,
      traceId,
      code: api.data.code,
      message: api.data.message,
    });
  }

  return new CausalityApiClientError({
    kind: 'api',
    status,
    traceId,
    code: 'API_REQUEST_FAILED',
    message: `Causality API 请求失败（HTTP ${status}）`,
  });
}

function parseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function requestAborted(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

export class CausalityApiClient {
  private readonly baseUrl: URL;
  private readonly token: string;
  private readonly internalSecret: string;
  private readonly pathPrefix: '/internal/mcp';
  private readonly clientName: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: typeof fetch;

  public constructor(options: CausalityApiClientOptions) {
    this.baseUrl = new URL(options.baseUrl);
    this.token = options.token;
    this.internalSecret = options.internalSecret;
    this.pathPrefix = options.pathPrefix;
    this.clientName = options.clientName;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImplementation = options.fetch ?? fetch;
  }

  public searchEvents(
    query: string,
    page = 1,
    searchMode: SearchMode = 'standard',
  ): Promise<EventListResponse> {
    return this.request('/events', {
      query: {
        q: query,
        page,
        ...(searchMode === 'enhanced' ? { searchMode } : {}),
      },
      schema: eventListResponseSchema,
    });
  }

  public getEvent(id: string): Promise<EventDetail> {
    return this.request(`/events/${encodeURIComponent(id)}`, {
      schema: eventDetailSchema,
    });
  }

  public getEventRelations(
    id: string,
    input: { limit: number; cursor?: string },
  ): Promise<EventRelationListResponse> {
    return this.request(`/events/${encodeURIComponent(id)}/relations`, {
      query: { limit: input.limit, cursor: input.cursor },
      schema: eventRelationListResponseSchema,
    });
  }

  public searchCases(query: string, page = 1): Promise<CaseListResponse> {
    return this.request('/cases', {
      query: { q: query, page },
      schema: caseListResponseSchema,
    });
  }

  public getCase(id: string): Promise<CaseDetail> {
    return this.request(`/cases/${encodeURIComponent(id)}`, {
      schema: caseDetailSchema,
    });
  }

  public getCaseRelations(
    id: string,
    input: { limit: number; cursor?: string },
  ): Promise<CaseRelationListResponse> {
    return this.request(`/cases/${encodeURIComponent(id)}/relations`, {
      query: { limit: input.limit, cursor: input.cursor },
      schema: caseRelationListResponseSchema,
    });
  }

  public searchRelations(
    query: string,
    searchMode: 'standard' | 'enhanced',
    page = 1,
  ): Promise<RelationListResponse> {
    return this.request('/relations', {
      query: { q: query, searchMode, page },
      schema: relationListResponseSchema,
    });
  }

  public getRelation(id: string): Promise<RelationDetail> {
    return this.request(`/relations/${encodeURIComponent(id)}`, {
      schema: relationDetailSchema,
    });
  }

  public getRelationCases(
    id: string,
    input: { limit: number; cursor?: string } = { limit: DEFAULT_RELATION_PAGE_SIZE },
  ): Promise<RelationCaseListResponse> {
    return this.request(`/relations/${encodeURIComponent(id)}/cases`, {
      query: { limit: input.limit, cursor: input.cursor },
      schema: relationCaseListResponseSchema,
    });
  }

  public queryGraph(input: CausalGraphQuery): Promise<CausalGraphResponse> {
    return this.request('/causal-graph', {
      query: input,
      schema: causalGraphResponseSchema,
    });
  }

  public findCausalPaths(input: CausalPathQuery): Promise<CausalPathResponse> {
    return this.request('/causal-paths', {
      query: input,
      schema: causalPathResponseSchema,
    });
  }

  public getCausalEvidenceBundle(
    input: CausalEvidenceBundleInput,
  ): Promise<CausalEvidenceBundleResponse> {
    return this.request('/causal-evidence-bundles', {
      method: 'POST',
      body: input,
      schema: causalEvidenceBundleResponseSchema,
    });
  }

  public getHealth(timeoutMs = STATUS_TIMEOUT_MS): Promise<HealthResponse> {
    return this.request('/health', {
      schema: healthResponseSchema,
      timeoutMs,
    });
  }

  public getReadiness(timeoutMs = STATUS_TIMEOUT_MS): Promise<ReadinessResponse> {
    return this.request('/ready', {
      schema: readinessResponseSchema,
      timeoutMs,
      acceptedStatuses: [503],
    });
  }

  public getSemanticLifecycle(timeoutMs = STATUS_TIMEOUT_MS): Promise<SemanticLifecycleSnapshot> {
    return this.request('/semantic/lifecycle', {
      schema: semanticLifecycleSnapshotSchema,
      timeoutMs,
    });
  }

  public compare(input: AiCaptureCandidateSet): Promise<AiCaptureComparison> {
    return this.request('/ai-captures/compare', {
      method: 'POST',
      body: input,
      schema: aiCaptureComparisonSchema,
    });
  }

  public prepare(input: PrepareAiImportPlanInput): Promise<AiImportPlan> {
    return this.request('/ai-captures/plans', {
      method: 'POST',
      body: input,
      schema: aiImportPlanSchema,
    });
  }

  public async planStatus(id: string): Promise<AiImportPlanStatus> {
    const plan = await this.request(`/ai-captures/plans/${encodeURIComponent(id)}`, {
      schema: aiImportPlanSchema,
    });
    return plan.status;
  }

  public commit(id: string): Promise<AiImportCommitResult> {
    return this.request(`/ai-captures/plans/${encodeURIComponent(id)}/commit`, {
      method: 'POST',
      schema: aiImportCommitResultSchema,
    });
  }

  public result(historyId: string): Promise<AiImportCommitResult> {
    return this.request(`/ai-captures/results/${encodeURIComponent(historyId)}`, {
      schema: aiImportCommitResultSchema,
    });
  }

  private async request<T>(path: string, options: RequestOptions<T>): Promise<T> {
    const traceId = randomUUID();
    if (!this.token || !this.internalSecret) {
      throw new CausalityApiClientError({
        kind: 'configuration',
        code: 'MCP_BRIDGE_CREDENTIALS_MISSING',
        message: 'MCP 内部访问凭据尚未配置',
        traceId,
      });
    }

    const url = new URL(`${this.pathPrefix}${path}`, this.baseUrl);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const headers = new Headers();
    headers.set('x-causality-trace-id', traceId);
    headers.set('x-causality-mcp-token', this.token);
    headers.set('x-causality-internal-mcp-secret', this.internalSecret);
    if (this.clientName) headers.set('x-causality-mcp-client-name', this.clientName);
    if (options.body !== undefined) headers.set('content-type', 'application/json');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? this.timeoutMs);

    let response: Response;
    let payload: unknown;
    try {
      response = await this.fetchImplementation(url, {
        method: options.method ?? 'GET',
        ...(Array.from(headers).length > 0 ? { headers } : {}),
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: controller.signal,
      });
      payload = parseJson(await response.text());
    } catch (error) {
      if (requestAborted(error) || controller.signal.aborted) {
        throw new CausalityApiClientError({
          kind: 'system',
          code: 'API_REQUEST_ABORTED',
          message: 'Causality API 请求已超时或被取消',
          traceId,
        });
      }
      throw new CausalityApiClientError({
        kind: 'system',
        code: 'API_UNAVAILABLE',
        message: '无法连接 Causality API',
        traceId,
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok && !options.acceptedStatuses?.includes(response.status)) {
      throw apiFailure(response.status, payload, traceId);
    }

    const parsed = options.schema.safeParse(payload);
    if (!parsed.success) {
      throw new CausalityApiClientError({
        kind: 'contract',
        code: 'INVALID_API_RESPONSE',
        message: 'Causality API 返回了不符合契约的数据',
        traceId,
      });
    }
    return parsed.data;
  }
}
