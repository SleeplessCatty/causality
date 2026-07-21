import type { CausalGraphQuery, CausalGraphResponse } from '@causality/contracts';

export type GraphLimit = CausalGraphQuery['limit'];

export type GraphQueryState = Pick<
  CausalGraphQuery,
  'centerEventId' | 'direction' | 'limit' | 'minConfidence' | 'minCaseCount'
>;

export type GraphFilterValues = Pick<GraphQueryState, 'minConfidence' | 'minCaseCount'>;

export interface GraphFilterDraft {
  minConfidence: string;
  minCaseCount: string;
}

export type GraphFilterValidationResult =
  | { success: true; values: GraphFilterValues }
  | {
      success: false;
      errors: Partial<Record<keyof GraphFilterDraft, string>>;
    };

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

const graphDirections = new Set<CausalGraphQuery['direction']>(['upstream', 'downstream', 'both']);
const graphLimits = new Set<GraphLimit>([20, 50, 100]);
const unsignedIntegerPattern = /^(0|[1-9]\d*)$/u;

function parseInteger(value: string | null, minimum: number, maximum?: number): number | null {
  if (!value || !unsignedIntegerPattern.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) return null;
  if (maximum !== undefined && parsed > maximum) return null;
  return parsed;
}

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
  const minConfidence =
    parseInteger(search.get('minConfidence'), 0, 100) ?? DEFAULT_GRAPH_QUERY_STATE.minConfidence;
  const minCaseCount =
    parseInteger(search.get('minCaseCount'), 0) ?? DEFAULT_GRAPH_QUERY_STATE.minCaseCount;
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

export function activeGraphFilterCount(values: GraphFilterValues): number {
  return Number(values.minConfidence > 0) + Number(values.minCaseCount > 0);
}

export function validateGraphFilterDraft(draft: GraphFilterDraft): GraphFilterValidationResult {
  const minConfidence = parseInteger(draft.minConfidence, 0, 100);
  const minCaseCount = parseInteger(draft.minCaseCount, 0);
  const errors: Partial<Record<keyof GraphFilterDraft, string>> = {};
  if (minConfidence === null) errors.minConfidence = '请输入 0 到 100 的整数';
  if (minCaseCount === null) errors.minCaseCount = '请输入大于等于 0 的整数';
  if (Object.keys(errors).length > 0) return { success: false, errors };
  return {
    success: true,
    values: { minConfidence: minConfidence!, minCaseCount: minCaseCount! },
  };
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
