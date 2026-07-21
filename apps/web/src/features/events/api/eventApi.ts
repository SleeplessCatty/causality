import {
  apiErrorSchema,
  eventCandidateListResponseSchema,
  eventDetailSchema,
  eventListResponseSchema,
  type ApiError,
  type EventCandidate,
  type EventDetail,
  type EventFormInput,
  type EventListResponse,
} from '@causality/contracts';

const requestTimeoutMilliseconds = 10_000;

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(requestTimeoutMilliseconds);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export class ApiClientError extends Error {
  constructor(readonly details: ApiError) {
    super(details.message);
    this.name = 'ApiClientError';
  }
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
    const error = apiErrorSchema.safeParse(body);
    throw new ApiClientError(
      error.success
        ? error.data
        : { code: 'INTERNAL_ERROR', message: '服务暂时不可用，请稍后重试' },
    );
  }
  return body;
}

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
  const parameters = new URLSearchParams({ q: query, limit: String(options.limit ?? 5) });
  if (options.excludeId) parameters.set('excludeId', options.excludeId);
  return eventCandidateListResponseSchema.parse(
    await requestJson(`/api/events/candidates?${parameters}`, {}, signal),
  ).items;
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
