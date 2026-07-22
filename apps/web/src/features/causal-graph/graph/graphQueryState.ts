import type { CausalGraphQuery, CausalGraphResponse } from '@causality/contracts';

export type GraphLimit = CausalGraphQuery['limit'];

export type GraphQueryState = Pick<
  CausalGraphQuery,
  'centerEventId' | 'direction' | 'limit' | 'minConfidence' | 'minCaseCount'
>;

export type GraphQueryStatus =
  | { action: 'none'; message: string; nextLimit: null }
  | { action: 'expand'; message: string; nextLimit: 50 | 100 }
  | { action: 'adjust_filter'; message: string; nextLimit: null };

export const DEFAULT_GRAPH_QUERY_STATE = {
  direction: 'both',
  limit: 20,
  minConfidence: 0,
  minCaseCount: 0,
} as const satisfies Omit<GraphQueryState, 'centerEventId'>;

export const graphLimitOptions = [20, 50, 100] as const satisfies readonly GraphLimit[];
export const graphConfidenceOptions = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100] as const;
export const graphCaseCountOptions = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

const graphDirections = new Set<CausalGraphQuery['direction']>(['upstream', 'downstream', 'both']);
const graphLimits = new Set<number>(graphLimitOptions);
const unsignedIntegerPattern = /^(0|[1-9]\d*)$/u;

function parseInteger(value: string | null, minimum: number, maximum?: number): number | null {
  if (!value || !unsignedIntegerPattern.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) return null;
  if (maximum !== undefined && parsed > maximum) return null;
  return parsed;
}

const normalizeConfidence = (value: number) =>
  Math.floor(Math.min(100, Math.max(0, value)) / 10) * 10;

const normalizeCaseCount = (value: number) => Math.min(10, Math.max(0, Math.floor(value)));

export function toGraphSearchParams(state: GraphQueryState): URLSearchParams {
  if (!state.centerEventId) return new URLSearchParams();
  return new URLSearchParams({
    centerEventId: state.centerEventId,
    direction: state.direction,
    limit: String(state.limit),
    minConfidence: String(state.minConfidence),
    minCaseCount: String(state.minCaseCount),
  });
}

export function parseGraphQueryState(search: URLSearchParams): {
  state: GraphQueryState;
  needsCanonicalization: boolean;
} {
  const centerEventId = search.get('centerEventId') ?? '';
  const directionValue = search.get('direction');
  const direction = graphDirections.has(directionValue as CausalGraphQuery['direction'])
    ? (directionValue as CausalGraphQuery['direction'])
    : DEFAULT_GRAPH_QUERY_STATE.direction;
  const parsedLimit = parseInteger(search.get('limit'), 0);
  const limit = graphLimits.has(parsedLimit as GraphLimit)
    ? (parsedLimit as GraphLimit)
    : DEFAULT_GRAPH_QUERY_STATE.limit;
  const minConfidence = normalizeConfidence(
    parseInteger(search.get('minConfidence'), 0) ?? DEFAULT_GRAPH_QUERY_STATE.minConfidence,
  );
  const minCaseCount = normalizeCaseCount(
    parseInteger(search.get('minCaseCount'), 0) ?? DEFAULT_GRAPH_QUERY_STATE.minCaseCount,
  );
  const state = { centerEventId, direction, limit, minConfidence, minCaseCount };
  const canonical = toGraphSearchParams(state).toString();

  return {
    state,
    needsCanonicalization: Boolean(centerEventId) && canonical !== search.toString(),
  };
}

export function nextGraphLimit(limit: GraphLimit): 50 | 100 | null {
  if (limit === 20) return 50;
  if (limit === 50) return 100;
  return null;
}

export function graphQueryStatus(graph: CausalGraphResponse): GraphQueryStatus {
  const { nodeLimit, stopReason } = graph.meta;
  if (stopReason === 'exhausted') {
    return {
      action: 'none',
      message: '当前条件下已展示全部可达内容',
      nextLimit: null,
    };
  }
  if (nodeLimit === 100) {
    return {
      action: 'adjust_filter',
      message: '已达到 100 节点显示上限',
      nextLimit: null,
    };
  }
  return {
    action: 'expand',
    message:
      stopReason === 'relation_limit' ? '关系较密集，已触发展示保护' : '已达到当前节点显示档位',
    nextLimit: nextGraphLimit(nodeLimit)!,
  };
}
