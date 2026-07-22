import {
  eventCandidateListResponseSchema,
  eventDetailSchema,
  eventListResponseSchema,
  type EventCandidate,
  type EventCandidateListResponse,
  type EventDetail,
  type EventFormInput,
  type EventListResponse,
} from '@causality/contracts';

import { requestJson } from '../../../shared/api/httpClient';

export async function getEvents(
  query: { q: string; cursor?: string; limit?: number },
  signal?: AbortSignal,
): Promise<EventListResponse> {
  const parameters = new URLSearchParams();
  if (query.q) parameters.set('q', query.q);
  if (query.cursor) parameters.set('cursor', query.cursor);
  parameters.set('limit', String(query.limit ?? 30));

  return eventListResponseSchema.parse(await requestJson(`/api/events?${parameters}`, {}, signal));
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
