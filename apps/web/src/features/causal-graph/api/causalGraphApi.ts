import {
  apiErrorSchema,
  causalGraphResponseSchema,
  type CausalGraphQuery,
  type CausalGraphResponse,
} from '@causality/contracts';

import { ApiClientError } from '../../events/api/eventApi';

const requestTimeoutMilliseconds = 10_000;

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(requestTimeoutMilliseconds);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export async function getCausalGraph(
  query: CausalGraphQuery,
  signal?: AbortSignal,
): Promise<CausalGraphResponse> {
  const parameters = new URLSearchParams({
    centerEventId: query.centerEventId,
    direction: query.direction,
    limit: String(query.limit),
    minConfidence: String(query.minConfidence),
    minCaseCount: String(query.minCaseCount),
  });
  const response = await fetch(`/api/causal-graph?${parameters}`, {
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

  return causalGraphResponseSchema.parse(body);
}
