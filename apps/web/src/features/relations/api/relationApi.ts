import {
  relationDetailSchema,
  relationListResponseSchema,
  relationPairCheckResponseSchema,
  type RelationDetail,
  type RelationFormInput,
  type RelationListResponse,
  type RelationPairCheckResponse,
} from '@causality/contracts';

import { ApiClientError } from '../../events/api/eventApi';
import { apiErrorSchema } from '@causality/contracts';

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

export async function getRelations(
  query: { q: string; cursor?: string; limit?: number },
  signal?: AbortSignal,
): Promise<RelationListResponse> {
  const parameters = new URLSearchParams();
  if (query.q) parameters.set('q', query.q);
  if (query.cursor) parameters.set('cursor', query.cursor);
  parameters.set('limit', String(query.limit ?? 30));
  return relationListResponseSchema.parse(
    await requestJson(`/api/relations?${parameters}`, {}, signal),
  );
}

export async function getRelation(id: string, signal?: AbortSignal): Promise<RelationDetail> {
  return relationDetailSchema.parse(await requestJson(`/api/relations/${id}`, {}, signal));
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
