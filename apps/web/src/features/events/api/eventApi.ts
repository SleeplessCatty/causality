import {
  DETAIL_ASSOCIATION_PAGE_SIZE,
  MAIN_LIST_PAGE_SIZE,
  deleteResultSchema,
  eventCandidateListResponseSchema,
  eventDeletionImpactSchema,
  eventDetailSchema,
  eventListResponseSchema,
  eventRelationListResponseSchema,
  type EventCandidate,
  type EventCandidateListResponse,
  type EventDeletionImpact,
  type EventDetail,
  type EventFormInput,
  type EventListResponse,
  type EventRelationListResponse,
  type SearchMode,
} from '@causality/contracts';

import { requestJson } from '../../../shared/api/httpClient';

export async function getEvents(
  query: {
    q: string;
    page: number;
    limit?: number;
    orphan?: boolean;
    searchMode?: SearchMode;
  },
  signal?: AbortSignal,
): Promise<EventListResponse> {
  const parameters = new URLSearchParams();
  if (query.q) parameters.set('q', query.q);
  if (query.orphan) parameters.set('orphan', 'true');
  if (query.searchMode === 'enhanced') parameters.set('searchMode', query.searchMode);
  parameters.set('page', String(query.page));
  parameters.set('limit', String(query.limit ?? MAIN_LIST_PAGE_SIZE));

  return eventListResponseSchema.parse(await requestJson(`/api/events?${parameters}`, {}, signal));
}

export async function getEventDeletionImpact(
  id: string,
  signal?: AbortSignal,
): Promise<EventDeletionImpact> {
  return eventDeletionImpactSchema.parse(
    await requestJson(`/api/events/${id}/deletion-impact`, {}, signal),
  );
}

export async function deleteEvent(id: string): Promise<void> {
  deleteResultSchema.parse(await requestJson(`/api/events/${id}`, { method: 'DELETE' }));
}

export async function getEventCandidates(
  query: string,
  options: { limit?: number; excludeId?: string } = {},
  signal?: AbortSignal,
): Promise<EventCandidate[]> {
  return (await getEventCandidatePage(query, options, signal)).items;
}

export async function getEventCandidatePage(
  query: string,
  options: { limit?: number; cursor?: string; excludeId?: string } = {},
  signal?: AbortSignal,
): Promise<EventCandidateListResponse> {
  const parameters = new URLSearchParams({ q: query, limit: String(options.limit ?? 100) });
  if (options.cursor) parameters.set('cursor', options.cursor);
  if (options.excludeId) parameters.set('excludeId', options.excludeId);
  return eventCandidateListResponseSchema.parse(
    await requestJson(`/api/events/candidates?${parameters}`, {}, signal),
  );
}

export async function getEvent(id: string, signal?: AbortSignal): Promise<EventDetail> {
  return eventDetailSchema.parse(await requestJson(`/api/events/${id}`, {}, signal));
}

export async function getEventRelations(
  id: string,
  options: { limit?: number; cursor?: string } = {},
  signal?: AbortSignal,
): Promise<EventRelationListResponse> {
  const parameters = new URLSearchParams({
    limit: String(options.limit ?? DETAIL_ASSOCIATION_PAGE_SIZE),
  });
  if (options.cursor) parameters.set('cursor', options.cursor);
  return eventRelationListResponseSchema.parse(
    await requestJson(`/api/events/${id}/relations?${parameters}`, {}, signal),
  );
}

export async function createEvent(input: EventFormInput): Promise<EventDetail> {
  return eventDetailSchema.parse(
    await requestJson('/api/events', { method: 'POST', body: JSON.stringify(input) }),
  );
}

export async function replaceEvent(id: string, input: EventFormInput): Promise<EventDetail> {
  return eventDetailSchema.parse(
    await requestJson(`/api/events/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  );
}
