import type {
  AiCaptureCandidateSet,
  AiCaptureComparison,
  AiCaptureQualityReport,
  AiImportCommitResult,
  AiImportPlan,
  CaseDetail,
  CaseListResponse,
  CaseRelationListResponse,
  CausalGraphResponse,
  EventDetail,
  EventListResponse,
  EventRelationListResponse,
  PrepareAiImportPlanInput,
  RelationCaseListResponse,
  RelationDetail,
  RelationListResponse,
} from '@causality/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CausalityApiClient } from '../src/api/causalityApiClient.js';
import type { CausalityApiClientError } from '../src/api/causalityApiClient.js';

const eventId = '10000000-0000-4000-8000-000000000001';
const effectEventId = '10000000-0000-4000-8000-000000000002';
const relationId = '20000000-0000-4000-8000-000000000001';
const caseId = '30000000-0000-4000-8000-000000000001';
const planId = '40000000-0000-4000-8000-000000000001';
const historyId = '50000000-0000-4000-8000-000000000001';
const timestamp = '2026-07-28T12:00:00.000Z';
const token = 'a'.repeat(64);

const eventDetail: EventDetail = {
  id: eventId,
  name: '供应链中断',
  description: '关键物流节点无法正常运转',
  aliases: ['物流受阻'],
  keywords: ['供应链'],
  relationCount: 1,
  listPage: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
};

const eventList: EventListResponse = {
  items: [
    {
      id: eventId,
      name: eventDetail.name,
      aliases: eventDetail.aliases,
      keywords: eventDetail.keywords,
      relationCount: 1,
      updatedAt: timestamp,
    },
  ],
  page: 1,
  pageSize: 50,
  totalItems: 1,
  totalPages: 1,
  semanticIndexNotice: null,
};

const eventRelations: EventRelationListResponse = {
  items: [
    {
      id: relationId,
      causeEvent: { id: eventId, name: eventDetail.name },
      effectEvent: { id: effectEventId, name: '交付周期延长' },
      linkedAt: timestamp,
    },
  ],
  nextCursor: 'next-relation-page',
  hasMore: true,
};

const caseList: CaseListResponse = {
  items: [
    {
      id: caseId,
      content: '港口停运后工厂原料延迟到货',
      relationCount: 1,
      updatedAt: timestamp,
    },
  ],
  page: 1,
  pageSize: 50,
  totalItems: 1,
  totalPages: 1,
  semanticIndexNotice: null,
};

const caseDetail: CaseDetail = {
  ...caseList.items[0]!,
  listPage: 1,
  createdAt: timestamp,
};

const caseRelations: CaseRelationListResponse = {
  items: [
    {
      id: relationId,
      causeEvent: { id: eventId, name: eventDetail.name },
      effectEvent: { id: effectEventId, name: '交付周期延长' },
      linkedAt: timestamp,
    },
  ],
  nextCursor: 'next-case-relations',
  hasMore: true,
};

const relationList: RelationListResponse = {
  items: [
    {
      id: relationId,
      causeEvent: { id: eventId, name: eventDetail.name },
      effectEvent: { id: effectEventId, name: '交付周期延长' },
      confidence: 20,
      caseCount: 1,
      updatedAt: timestamp,
    },
  ],
  page: 2,
  pageSize: 50,
  totalItems: 1,
  totalPages: 1,
  semanticIndexNotice: null,
};

const relationDetail: RelationDetail = {
  id: relationId,
  causeEvent: { id: eventId, name: eventDetail.name },
  effectEvent: { id: effectEventId, name: '交付周期延长' },
  confidence: 20,
  caseCount: 1,
  description: '物流受阻会延长交付周期',
  listPage: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
  recentCases: [{ id: caseId, content: caseList.items[0]!.content }],
};

const relationCases: RelationCaseListResponse = {
  items: [
    {
      ...caseList.items[0]!,
      linkedAt: timestamp,
    },
  ],
  nextCursor: null,
  hasMore: false,
};

const graph: CausalGraphResponse = {
  nodes: [
    { id: eventId, name: eventDetail.name },
    { id: effectEventId, name: '交付周期延长' },
  ],
  relations: [
    {
      id: relationId,
      causeEventId: eventId,
      effectEventId,
      confidence: 20,
      caseCount: 1,
    },
  ],
  meta: {
    centerEventId: eventId,
    direction: 'both',
    nodeLimit: 20,
    relationLimit: 200,
    minConfidence: 10,
    minCaseCount: 1,
    nodeCount: 2,
    relationCount: 1,
    stopReason: 'exhausted',
  },
};

const candidates: AiCaptureCandidateSet = {
  topic: '供应链变化',
  clientName: 'mcp-test',
  atomicEvents: [],
  concreteCases: [],
  causalRelations: [],
  relationCaseLinks: [],
};

const blockedReport: AiCaptureQualityReport = {
  version: 1,
  status: 'blocked',
  issues: [
    {
      code: 'AI_QUALITY_ORPHAN_EVENT',
      severity: 'error',
      phase: 'candidate',
      entityType: 'event',
      refs: ['event-invalid'],
      paths: ['/atomicEvents/0'],
      message: '原子事件未参与任何因果关系',
      suggestedAction: '为原子事件补充因果关系，或将其从候选中移除',
      aiCanRepair: true,
    },
  ],
  topicRelevance: [],
};

const comparison: AiCaptureComparison = {
  atomicEvents: [],
  concreteCases: [],
  causalRelations: [],
  relationCaseLinks: [],
  qualityReport: {
    version: 1,
    status: 'passed',
    issues: [],
    topicRelevance: [],
  },
};

const counts = {
  eventCreated: 0,
  eventReused: 0,
  eventUpdated: 0,
  caseCreated: 0,
  caseReused: 0,
  relationCreated: 0,
  relationReused: 0,
  relationCaseCreated: 0,
  relationCaseReused: 0,
  confidenceChanged: 0,
};

const prepareInput: PrepareAiImportPlanInput = {
  candidates,
  comparison,
  decisions: {
    atomicEvents: [],
    concreteCases: [],
    causalRelations: [],
    relationCaseLinks: [],
  },
};

const plan: AiImportPlan = {
  id: planId,
  version: 1,
  replacesPlanId: null,
  status: 'pending',
  topic: candidates.topic,
  clientName: candidates.clientName,
  candidates,
  comparison,
  decisions: prepareInput.decisions,
  summary: counts,
  createdAt: timestamp,
  expiresAt: '2026-07-28T12:30:00.000Z',
  committedAt: null,
  error: null,
  result: null,
};

const commitResult: AiImportCommitResult = {
  planId,
  historyId,
  marker: `[Causality-Capture: ${historyId}]`,
  noChanges: true,
  counts,
  completedAt: timestamp,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createClient(fetchImplementation: typeof fetch) {
  return new CausalityApiClient({
    baseUrl: 'http://api.test:3000/',
    token,
    timeoutMs: 100,
    fetch: fetchImplementation,
  });
}

describe('CausalityApiClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('encodes ordinary event and case searches without forwarding the MCP token', async () => {
    const requests: Array<{ url: URL; init?: RequestInit }> = [];
    const fetchImplementation: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      requests.push({ url, ...(init ? { init } : {}) });
      return jsonResponse(url.pathname === '/api/events' ? eventList : caseList);
    };
    const client = createClient(fetchImplementation);

    const events = await client.searchEvents('供应 链/港口', 3);
    const cases = await client.searchCases('停运 后', 4);

    expect(events.items[0]?.name).toBe('供应链中断');
    expect(cases.items[0]?.content).toBe('港口停运后工厂原料延迟到货');
    expect(
      requests.map(({ url }) => [
        url.pathname,
        url.searchParams.get('q'),
        url.searchParams.get('page'),
      ]),
    ).toEqual([
      ['/api/events', '供应 链/港口', '3'],
      ['/api/cases', '停运 后', '4'],
    ]);
    for (const request of requests) {
      const headers = new Headers(request.init?.headers);
      expect(headers.get('x-causality-mcp-token')).toBeNull();
      expect(headers.get('x-causality-trace-id')).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('uses bounded relation pagination and complete graph query parameters', async () => {
    const urls: URL[] = [];
    const fetchImplementation: typeof fetch = async (input) => {
      const url = new URL(String(input));
      urls.push(url);
      if (url.pathname.endsWith('/relations')) return jsonResponse(eventRelations);
      if (url.pathname.endsWith('/cases')) return jsonResponse(relationCases);
      return jsonResponse(graph);
    };
    const client = createClient(fetchImplementation);

    await client.getEventRelations(eventId, { limit: 20, cursor: 'cursor value' });
    await client.getRelationCases(relationId, { limit: 50, cursor: 'case cursor' });
    await client.queryGraph({
      centerEventId: eventId,
      direction: 'both',
      limit: 20,
      minConfidence: 10,
      minCaseCount: 1,
    });

    expect(urls[0]?.pathname).toBe(`/api/events/${eventId}/relations`);
    expect(Object.fromEntries(urls[0]!.searchParams)).toEqual({
      limit: '20',
      cursor: 'cursor value',
    });
    expect(urls[1]?.pathname).toBe(`/api/relations/${relationId}/cases`);
    expect(Object.fromEntries(urls[1]!.searchParams)).toEqual({
      limit: '50',
      cursor: 'case cursor',
    });
    expect(Object.fromEntries(urls[2]!.searchParams)).toEqual({
      centerEventId: eventId,
      direction: 'both',
      limit: '20',
      minConfidence: '10',
      minCaseCount: '1',
    });
  });

  it('reads a case with relation continuation and performs explicit relation search', async () => {
    const requests: Array<{ url: URL; init?: RequestInit }> = [];
    const fetchImplementation: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      requests.push({ url, ...(init ? { init } : {}) });
      if (url.pathname === `/api/cases/${caseId}`) return jsonResponse(caseDetail);
      if (url.pathname === `/api/cases/${caseId}/relations`) {
        return jsonResponse(caseRelations);
      }
      return jsonResponse(relationList);
    };
    const client = createClient(fetchImplementation);

    await client.getCase(caseId);
    await client.getCaseRelations(caseId, {
      limit: 20,
      cursor: 'next-case-relations',
    });
    await client.searchRelations('融资成本', 'standard', 2);

    expect(requests.map(({ url }) => [url.pathname, Object.fromEntries(url.searchParams)])).toEqual(
      [
        [`/api/cases/${caseId}`, {}],
        [`/api/cases/${caseId}/relations`, { limit: '20', cursor: 'next-case-relations' }],
        ['/api/relations', { q: '融资成本', searchMode: 'standard', page: '2' }],
      ],
    );
    for (const request of requests) {
      expect(new Headers(request.init?.headers).get('x-causality-mcp-token')).toBeNull();
    }
  });

  it('keeps API adapter pagination defaults for existing callers', async () => {
    const urls: URL[] = [];
    const fetchImplementation: typeof fetch = async (input) => {
      const url = new URL(String(input));
      urls.push(url);
      if (url.pathname === '/api/events') return jsonResponse(eventList);
      if (url.pathname === '/api/cases') return jsonResponse(caseList);
      return jsonResponse(relationCases);
    };
    const client = createClient(fetchImplementation);

    await client.searchEvents('供应链');
    await client.searchCases('港口停运');
    await client.getRelationCases(relationId);

    expect(Object.fromEntries(urls[0]!.searchParams)).toEqual({ q: '供应链', page: '1' });
    expect(Object.fromEntries(urls[1]!.searchParams)).toEqual({ q: '港口停运', page: '1' });
    expect(Object.fromEntries(urls[2]!.searchParams)).toEqual({ limit: '20' });
  });

  it('parses event and relation detail contracts', async () => {
    const fetchImplementation: typeof fetch = async (input) => {
      const path = new URL(String(input)).pathname;
      return jsonResponse(path.startsWith('/api/events/') ? eventDetail : relationDetail);
    };
    const client = createClient(fetchImplementation);

    const event = await client.getEvent(eventId);
    const relation = await client.getRelation(relationId);

    expect(event).toMatchObject({ id: eventId, name: '供应链中断' });
    expect(relation).toMatchObject({
      id: relationId,
      confidence: 20,
      caseCount: 1,
    });
  });

  it('forwards the MCP token only for protected workflow operations', async () => {
    const requests: Array<{ url: URL; init?: RequestInit }> = [];
    const responses = new Map<string, unknown>([
      ['/api/ai-captures/compare', comparison],
      ['/api/ai-captures/plans', plan],
      [`/api/ai-captures/plans/${planId}`, plan],
      [`/api/ai-captures/plans/${planId}/commit`, commitResult],
      [`/api/ai-captures/results/${historyId}`, commitResult],
    ]);
    const fetchImplementation: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      requests.push({ url, ...(init ? { init } : {}) });
      return jsonResponse(responses.get(url.pathname));
    };
    const client = createClient(fetchImplementation);

    await client.compare(candidates);
    await client.prepare(prepareInput);
    const status = await client.planStatus(planId);
    await client.commit(planId);
    await client.result(historyId);

    expect(status).toBe('pending');
    expect(requests).toHaveLength(5);
    for (const request of requests) {
      expect(new Headers(request.init?.headers).get('x-causality-mcp-token')).toBe(token);
      expect(new Headers(request.init?.headers).get('x-causality-trace-id')).toMatch(
        /^[0-9a-f-]{36}$/,
      );
    }
    expect(requests[0]?.init?.method).toBe('POST');
    expect(requests[1]?.init?.method).toBe('POST');
    expect(requests[2]?.init?.method).toBe('GET');
  });

  it('turns a structured API failure into a typed client error', async () => {
    const client = createClient(async () =>
      jsonResponse({ code: 'EVENT_NOT_FOUND', message: '原子事件不存在' }, 404),
    );

    await expect(client.getEvent(eventId)).rejects.toMatchObject({
      name: 'CausalityApiClientError',
      kind: 'api',
      status: 404,
      code: 'EVENT_NOT_FOUND',
      message: '原子事件不存在',
    } satisfies Partial<CausalityApiClientError>);
  });

  it('preserves a validated quality report from a workflow API failure', async () => {
    const client = createClient(async () =>
      jsonResponse(
        {
          category: 'data',
          code: 'AI_CANDIDATE_QUALITY_BLOCKED',
          message: '候选集合存在必须修复的质量问题',
          affectedRefs: ['event-invalid'],
          aiCanRepair: true,
          retryCurrentPlan: false,
          suggestedAction: '根据质量报告修正完整候选集合后重新对比',
          qualityReport: blockedReport,
        },
        400,
      ),
    );

    await expect(client.compare(candidates)).rejects.toMatchObject({
      code: 'AI_CANDIDATE_QUALITY_BLOCKED',
      qualityReport: blockedReport,
    } satisfies Partial<CausalityApiClientError>);
  });

  it('rejects a successful response that violates the shared contract', async () => {
    const client = createClient(async () => jsonResponse({ items: [] }));

    await expect(client.searchEvents('供应链')).rejects.toMatchObject({
      kind: 'contract',
      code: 'INVALID_API_RESPONSE',
    } satisfies Partial<CausalityApiClientError>);
  });

  it('rejects invalid case detail, case relations, and relation search responses', async () => {
    const client = createClient(async () => jsonResponse({ items: [] }));

    await expect(client.getCase(caseId)).rejects.toMatchObject({
      kind: 'contract',
      code: 'INVALID_API_RESPONSE',
    } satisfies Partial<CausalityApiClientError>);
    await expect(client.getCaseRelations(caseId, { limit: 20 })).rejects.toMatchObject({
      kind: 'contract',
      code: 'INVALID_API_RESPONSE',
    } satisfies Partial<CausalityApiClientError>);
    await expect(client.searchRelations('供应链', 'standard')).rejects.toMatchObject({
      kind: 'contract',
      code: 'INVALID_API_RESPONSE',
    } satisfies Partial<CausalityApiClientError>);
  });

  it('classifies timeout or abort as a body-free system error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const secretBody = '不得记录的候选正文';
    const client = createClient(async () => {
      throw new DOMException(`${secretBody} aborted`, 'AbortError');
    });

    let failure: unknown;
    try {
      await client.compare(candidates);
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      kind: 'system',
      code: 'API_REQUEST_ABORTED',
    } satisfies Partial<CausalityApiClientError>);
    expect(String(failure)).not.toContain(secretBody);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('keeps abort handling active while reading the response body', async () => {
    const secretBody = '不得泄露的响应正文';
    const client = createClient(async () => {
      const response = jsonResponse(eventList);
      Object.defineProperty(response, 'text', {
        value: async () => {
          throw new DOMException(`${secretBody} aborted`, 'AbortError');
        },
      });
      return response;
    });

    let failure: unknown;
    try {
      await client.searchEvents('供应链');
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      kind: 'system',
      code: 'API_REQUEST_ABORTED',
    } satisfies Partial<CausalityApiClientError>);
    expect(String(failure)).not.toContain(secretBody);
  });
});
