import {
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

import { requestJson } from '../../../shared/api/httpClient';

export async function getCases(
  query: { q: string; relationId?: string; page: number; limit?: number },
  signal?: AbortSignal,
): Promise<CaseListResponse> {
  const parameters = new URLSearchParams();
  if (query.q) parameters.set('q', query.q);
  if (query.relationId) parameters.set('relationId', query.relationId);
  parameters.set('page', String(query.page));
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
