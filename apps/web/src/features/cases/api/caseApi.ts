import {
  apiErrorSchema,
  caseCandidateListResponseSchema,
  caseDetailSchema,
  caseListResponseSchema,
  caseRelationListResponseSchema,
  type CaseCandidateListResponse,
  type CaseDetail,
  type CaseFormInput,
  type CaseListResponse,
  type CaseReference,
  type CaseRelationListResponse,
} from '@causality/contracts';

import { ApiClientError } from '../../events/api/eventApi';

const requestTimeoutMilliseconds = 10_000;

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(requestTimeoutMilliseconds);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function requestJson(
  url: string,
  options: RequestInit = {},
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
    signal: requestSignal(signal),
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(body);
    throw new ApiClientError(
      parsed.success
        ? parsed.data
        : { code: 'INTERNAL_ERROR', message: '服务暂时不可用，请稍后重试' },
    );
  }
  return body;
}

export async function getCases(
  query: { q: string; relationId?: string; cursor?: string; limit?: number },
  signal?: AbortSignal,
): Promise<CaseListResponse> {
  const parameters = new URLSearchParams();
  if (query.q) parameters.set('q', query.q);
  if (query.relationId) parameters.set('relationId', query.relationId);
  if (query.cursor) parameters.set('cursor', query.cursor);
  parameters.set('limit', String(query.limit ?? 30));
  return caseListResponseSchema.parse(await requestJson(`/api/cases?${parameters}`, {}, signal));
}

export async function getCaseCandidates(
  query: string,
  signal?: AbortSignal,
): Promise<CaseReference[]> {
  return (await getCaseCandidatePage(query, {}, signal)).items;
}

export async function getCaseCandidatePage(
  query: string,
  options: { limit?: number; cursor?: string } = {},
  signal?: AbortSignal,
): Promise<CaseCandidateListResponse> {
  const parameters = new URLSearchParams({ q: query, limit: String(options.limit ?? 100) });
  if (options.cursor) parameters.set('cursor', options.cursor);
  return caseCandidateListResponseSchema.parse(
    await requestJson(`/api/cases/candidates?${parameters}`, {}, signal),
  );
}

export async function getCase(id: string, signal?: AbortSignal): Promise<CaseDetail> {
  return caseDetailSchema.parse(await requestJson(`/api/cases/${id}`, {}, signal));
}

export async function getCaseRelations(
  id: string,
  query: { cursor?: string; limit?: number } = {},
  signal?: AbortSignal,
): Promise<CaseRelationListResponse> {
  const parameters = new URLSearchParams({ limit: String(query.limit ?? 30) });
  if (query.cursor) parameters.set('cursor', query.cursor);
  return caseRelationListResponseSchema.parse(
    await requestJson(`/api/cases/${id}/relations?${parameters}`, {}, signal),
  );
}

export async function getAllCasesForRelation(
  relationId: string,
  signal?: AbortSignal,
): Promise<CaseReference[]> {
  const items: CaseReference[] = [];
  let cursor: string | undefined;
  const visitedCursors = new Set<string>();

  do {
    const page = await getCases(
      { q: '', relationId, limit: 100, ...(cursor ? { cursor } : {}) },
      signal,
    );
    items.push(...page.items.map(({ id, content }) => ({ id, content })));
    if (!page.hasMore || !page.nextCursor) break;
    if (visitedCursors.has(page.nextCursor)) throw new Error('案例分页游标重复');
    visitedCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  } while (cursor);

  return items;
}

export async function createCase(input: CaseFormInput): Promise<CaseDetail> {
  return caseDetailSchema.parse(
    await requestJson('/api/cases', { method: 'POST', body: JSON.stringify(input) }),
  );
}

export async function replaceCase(id: string, input: CaseFormInput): Promise<CaseDetail> {
  return caseDetailSchema.parse(
    await requestJson(`/api/cases/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  );
}
