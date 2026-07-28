import {
  aiCaptureComparisonSchema,
  aiImportCommitResultSchema,
  aiImportPlanSchema,
  aiWorkflowErrorSchema,
  apiErrorSchema,
  caseListResponseSchema,
  causalGraphResponseSchema,
  eventDetailSchema,
  eventListResponseSchema,
  eventRelationListResponseSchema,
  relationCaseListResponseSchema,
  relationDetailSchema,
  type AiCaptureCandidateSet,
  type AiCaptureComparison,
  type AiImportCommitResult,
  type AiImportPlan,
  type AiImportPlanStatus,
  type AiWorkflowError,
  type CaseListResponse,
  type CausalGraphQuery,
  type CausalGraphResponse,
  type EventDetail,
  type EventListResponse,
  type EventRelationListResponse,
  type PrepareAiImportPlanInput,
  type RelationCaseListResponse,
  type RelationDetail,
} from '@causality/contracts';
import type { z } from 'zod';

export type CausalityApiClientErrorKind = 'api' | 'configuration' | 'contract' | 'system';

interface CausalityApiClientErrorOptions {
  kind: CausalityApiClientErrorKind;
  code: string;
  message: string;
  status?: number;
  workflowError?: AiWorkflowError;
  cause?: unknown;
}

export class CausalityApiClientError extends Error {
  public readonly kind: CausalityApiClientErrorKind;
  public readonly code: string;
  public readonly status: number | undefined;
  public readonly category: AiWorkflowError['category'] | undefined;
  public readonly affectedRefs: string[];
  public readonly aiCanRepair: boolean | undefined;
  public readonly retryCurrentPlan: boolean | undefined;
  public readonly suggestedAction: string | undefined;

  public constructor(options: CausalityApiClientErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'CausalityApiClientError';
    this.kind = options.kind;
    this.code = options.code;
    this.status = options.status;
    this.category = options.workflowError?.category;
    this.affectedRefs = options.workflowError?.affectedRefs ?? [];
    this.aiCanRepair = options.workflowError?.aiCanRepair;
    this.retryCurrentPlan = options.workflowError?.retryCurrentPlan;
    this.suggestedAction = options.workflowError?.suggestedAction;
  }
}

export interface CausalityApiClientOptions {
  baseUrl: string;
  token?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

interface RequestOptions<T> {
  schema: z.ZodType<T>;
  query?: Record<string, string | number | undefined>;
  method?: 'GET' | 'POST';
  body?: unknown;
  protected?: boolean;
}

const DEFAULT_TIMEOUT_MS = 35_000;
const DEFAULT_RELATION_PAGE_SIZE = 20;

function apiFailure(status: number, payload: unknown): CausalityApiClientError {
  const workflow = aiWorkflowErrorSchema.safeParse(payload);
  if (workflow.success) {
    return new CausalityApiClientError({
      kind: 'api',
      status,
      code: workflow.data.code,
      message: workflow.data.message,
      workflowError: workflow.data,
    });
  }

  const api = apiErrorSchema.safeParse(payload);
  if (api.success) {
    return new CausalityApiClientError({
      kind: 'api',
      status,
      code: api.data.code,
      message: api.data.message,
    });
  }

  return new CausalityApiClientError({
    kind: 'api',
    status,
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
  private readonly token: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: typeof fetch;

  public constructor(options: CausalityApiClientOptions) {
    this.baseUrl = new URL(options.baseUrl);
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImplementation = options.fetch ?? fetch;
  }

  public searchEvents(query: string): Promise<EventListResponse> {
    return this.request('/api/events', {
      query: { q: query },
      schema: eventListResponseSchema,
    });
  }

  public getEvent(id: string): Promise<EventDetail> {
    return this.request(`/api/events/${encodeURIComponent(id)}`, {
      schema: eventDetailSchema,
    });
  }

  public getEventRelations(
    id: string,
    input: { limit: number; cursor?: string },
  ): Promise<EventRelationListResponse> {
    return this.request(`/api/events/${encodeURIComponent(id)}/relations`, {
      query: { limit: input.limit, cursor: input.cursor },
      schema: eventRelationListResponseSchema,
    });
  }

  public searchCases(query: string): Promise<CaseListResponse> {
    return this.request('/api/cases', {
      query: { q: query },
      schema: caseListResponseSchema,
    });
  }

  public getRelation(id: string): Promise<RelationDetail> {
    return this.request(`/api/relations/${encodeURIComponent(id)}`, {
      schema: relationDetailSchema,
    });
  }

  public getRelationCases(id: string): Promise<RelationCaseListResponse> {
    return this.request(`/api/relations/${encodeURIComponent(id)}/cases`, {
      query: { limit: DEFAULT_RELATION_PAGE_SIZE },
      schema: relationCaseListResponseSchema,
    });
  }

  public queryGraph(input: CausalGraphQuery): Promise<CausalGraphResponse> {
    return this.request('/api/causal-graph', {
      query: input,
      schema: causalGraphResponseSchema,
    });
  }

  public compare(input: AiCaptureCandidateSet): Promise<AiCaptureComparison> {
    return this.request('/api/ai-captures/compare', {
      method: 'POST',
      body: input,
      protected: true,
      schema: aiCaptureComparisonSchema,
    });
  }

  public prepare(input: PrepareAiImportPlanInput): Promise<AiImportPlan> {
    return this.request('/api/ai-captures/plans', {
      method: 'POST',
      body: input,
      protected: true,
      schema: aiImportPlanSchema,
    });
  }

  public async planStatus(id: string): Promise<AiImportPlanStatus> {
    const plan = await this.request(`/api/ai-captures/plans/${encodeURIComponent(id)}`, {
      protected: true,
      schema: aiImportPlanSchema,
    });
    return plan.status;
  }

  public commit(id: string): Promise<AiImportCommitResult> {
    return this.request(`/api/ai-captures/plans/${encodeURIComponent(id)}/commit`, {
      method: 'POST',
      protected: true,
      schema: aiImportCommitResultSchema,
    });
  }

  public result(historyId: string): Promise<AiImportCommitResult> {
    return this.request(`/api/ai-captures/results/${encodeURIComponent(historyId)}`, {
      protected: true,
      schema: aiImportCommitResultSchema,
    });
  }

  private async request<T>(path: string, options: RequestOptions<T>): Promise<T> {
    if (options.protected && !this.token) {
      throw new CausalityApiClientError({
        kind: 'configuration',
        code: 'MCP_TOKEN_MISSING',
        message: 'MCP 访问令牌尚未配置',
      });
    }

    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const headers = new Headers();
    if (options.body !== undefined) headers.set('content-type', 'application/json');
    if (options.protected) headers.set('x-causality-mcp-token', this.token!);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

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
        });
      }
      throw new CausalityApiClientError({
        kind: 'system',
        code: 'API_UNAVAILABLE',
        message: '无法连接 Causality API',
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) throw apiFailure(response.status, payload);

    const parsed = options.schema.safeParse(payload);
    if (!parsed.success) {
      throw new CausalityApiClientError({
        kind: 'contract',
        code: 'INVALID_API_RESPONSE',
        message: 'Causality API 返回了不符合契约的数据',
      });
    }
    return parsed.data;
  }
}
