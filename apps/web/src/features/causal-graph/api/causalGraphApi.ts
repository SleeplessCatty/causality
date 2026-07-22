import {
  causalGraphResponseSchema,
  type CausalGraphQuery,
  type CausalGraphResponse,
} from '@causality/contracts';

import { requestJson } from '../../../shared/api/httpClient';

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
  return causalGraphResponseSchema.parse(
    await requestJson(`/api/causal-graph?${parameters}`, {}, signal),
  );
}
