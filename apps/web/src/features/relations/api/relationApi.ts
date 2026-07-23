import {
  DETAIL_ASSOCIATION_PAGE_SIZE,
  MAIN_LIST_PAGE_SIZE,
  deleteResultSchema,
  relationDeletionImpactSchema,
  relationDetailSchema,
  relationCaseListResponseSchema,
  relationListResponseSchema,
  relationPairCheckResponseSchema,
  type RelationDetail,
  type RelationDeletionImpact,
  type RelationCaseListResponse,
  type RelationFormInput,
  type RelationListResponse,
  type RelationPairCheckResponse,
} from '@causality/contracts';
import type { CaseReference } from '@causality/contracts';

import { requestJson } from '../../../shared/api/httpClient';

export async function getRelations(
  query: { q: string; page: number; limit?: number; orphan?: boolean; eventId?: string },
  signal?: AbortSignal,
): Promise<RelationListResponse> {
  const parameters = new URLSearchParams();
  if (query.q) parameters.set('q', query.q);
  if (query.orphan) parameters.set('orphan', 'true');
  if (query.eventId) parameters.set('eventId', query.eventId);
  parameters.set('page', String(query.page));
  parameters.set('limit', String(query.limit ?? MAIN_LIST_PAGE_SIZE));
  return relationListResponseSchema.parse(
    await requestJson(`/api/relations?${parameters}`, {}, signal),
  );
}

export async function getRelationDeletionImpact(
  id: string,
  signal?: AbortSignal,
): Promise<RelationDeletionImpact> {
  return relationDeletionImpactSchema.parse(
    await requestJson(`/api/relations/${id}/deletion-impact`, {}, signal),
  );
}

export async function deleteRelation(id: string): Promise<void> {
  deleteResultSchema.parse(await requestJson(`/api/relations/${id}`, { method: 'DELETE' }));
}

export async function getRelation(id: string, signal?: AbortSignal): Promise<RelationDetail> {
  return relationDetailSchema.parse(await requestJson(`/api/relations/${id}`, {}, signal));
}

export async function getRelationCases(
  relationId: string,
  options: { limit?: number; cursor?: string } = {},
  signal?: AbortSignal,
): Promise<RelationCaseListResponse> {
  const parameters = new URLSearchParams({
    limit: String(options.limit ?? DETAIL_ASSOCIATION_PAGE_SIZE),
  });
  if (options.cursor) parameters.set('cursor', options.cursor);
  return relationCaseListResponseSchema.parse(
    await requestJson(`/api/relations/${relationId}/cases?${parameters}`, {}, signal),
  );
}

export async function getAllRelationCases(
  relationId: string,
  signal?: AbortSignal,
): Promise<CaseReference[]> {
  const items: CaseReference[] = [];
  let cursor: string | undefined;
  const visitedCursors = new Set<string>();

  do {
    const page = await getRelationCases(
      relationId,
      { limit: 100, ...(cursor ? { cursor } : {}) },
      signal,
    );
    items.push(...page.items.map(({ id, content }) => ({ id, content })));
    if (!page.hasMore || !page.nextCursor) break;
    if (visitedCursors.has(page.nextCursor)) throw new Error('关系案例分页游标重复');
    visitedCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  } while (cursor);

  return items;
}

export async function checkRelationPair(
  causeEventId: string,
  effectEventId: string,
  excludeId?: string,
  signal?: AbortSignal,
): Promise<RelationPairCheckResponse> {
  const parameters = new URLSearchParams({ causeEventId, effectEventId });
  if (excludeId) parameters.set('excludeId', excludeId);
  return relationPairCheckResponseSchema.parse(
    await requestJson(`/api/relations/pair-check?${parameters}`, {}, signal),
  );
}

export async function createRelation(input: RelationFormInput): Promise<RelationDetail> {
  return relationDetailSchema.parse(
    await requestJson('/api/relations', { method: 'POST', body: JSON.stringify(input) }),
  );
}

export async function replaceRelation(
  id: string,
  input: RelationFormInput,
): Promise<RelationDetail> {
  return relationDetailSchema.parse(
    await requestJson(`/api/relations/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  );
}
