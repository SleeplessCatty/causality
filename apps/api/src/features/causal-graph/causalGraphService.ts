import type {
  CausalGraphNode,
  CausalGraphQuery,
  CausalGraphRelation,
  CausalGraphResponse,
  CausalGraphStopReason,
} from '@causality/contracts';

import type {
  CausalGraphFilters,
  CausalGraphRepository,
  CausalGraphSnapshot,
} from './causalGraphTypes.js';

const relationLimits = { 20: 200, 50: 500, 100: 1_000 } as const;

export class CausalGraphServiceError extends Error {
  constructor(
    readonly code: 'EVENT_NOT_FOUND',
    message: string,
  ) {
    super(message);
    this.name = 'CausalGraphServiceError';
  }
}

function sortRelations(relations: CausalGraphRelation[]): CausalGraphRelation[] {
  return [...relations].sort(
    (left, right) =>
      right.confidence - left.confidence ||
      right.caseCount - left.caseCount ||
      left.id.localeCompare(right.id),
  );
}

function response(
  nodes: CausalGraphNode[],
  relations: CausalGraphRelation[],
  query: CausalGraphQuery,
  stopReason: CausalGraphStopReason,
): CausalGraphResponse {
  return {
    nodes,
    relations,
    meta: {
      centerEventId: query.centerEventId,
      direction: query.direction,
      nodeLimit: query.limit,
      relationLimit: relationLimits[query.limit],
      minConfidence: query.minConfidence,
      minCaseCount: query.minCaseCount,
      nodeCount: nodes.length,
      relationCount: relations.length,
      stopReason,
    },
  };
}

function applyRelationLimit(
  nodes: CausalGraphNode[],
  relations: CausalGraphRelation[],
  query: CausalGraphQuery,
  stopReason: CausalGraphStopReason,
): CausalGraphResponse {
  const limit = relationLimits[query.limit];
  if (relations.length <= limit) return response(nodes, relations, query, stopReason);

  const nodeIndexes = new Map(nodes.map((event, index) => [event.id, index]));
  let lastAllowedIndex = 0;

  for (let candidateIndex = 1; candidateIndex < nodes.length; candidateIndex += 1) {
    const relationCount = relations.reduce((count, relation) => {
      const causeIndex = nodeIndexes.get(relation.causeEventId);
      const effectIndex = nodeIndexes.get(relation.effectEventId);
      return causeIndex !== undefined &&
        effectIndex !== undefined &&
        causeIndex <= candidateIndex &&
        effectIndex <= candidateIndex
        ? count + 1
        : count;
    }, 0);
    if (relationCount > limit) break;
    lastAllowedIndex = candidateIndex;
  }

  const limitedNodes = nodes.slice(0, lastAllowedIndex + 1);
  const limitedNodeIds = new Set(limitedNodes.map((event) => event.id));
  const limitedRelations = relations.filter(
    (relation) =>
      limitedNodeIds.has(relation.causeEventId) && limitedNodeIds.has(relation.effectEventId),
  );
  return response(limitedNodes, limitedRelations, query, 'relation_limit');
}

async function loadDiscoveredEvents(
  snapshot: CausalGraphSnapshot,
  nextIds: string[],
): Promise<CausalGraphNode[]> {
  if (nextIds.length === 0) return [];
  const eventsById = new Map(
    (await snapshot.findEvents(nextIds)).map((event) => [event.id, event]),
  );
  return nextIds.map((id) => {
    const event = eventsById.get(id);
    if (!event) throw new Error(`Graph endpoint event missing: ${id}`);
    return event;
  });
}

export class CausalGraphService {
  constructor(private readonly repository: CausalGraphRepository) {}

  query(query: CausalGraphQuery): Promise<CausalGraphResponse> {
    return this.repository.withSnapshot(async (snapshot) => {
      const center = await snapshot.findEvent(query.centerEventId);
      if (!center) throw new CausalGraphServiceError('EVENT_NOT_FOUND', '中心事件不存在');

      const filters: CausalGraphFilters = {
        minConfidence: query.minConfidence,
        minCaseCount: query.minCaseCount,
      };
      const nodes = [center];
      const visited = new Set([center.id]);
      let frontier = [center.id];
      let stopReason: CausalGraphStopReason = 'exhausted';

      while (frontier.length > 0 && nodes.length - 1 < query.limit) {
        const remaining = query.limit - (nodes.length - 1);
        const nextIds = await snapshot.findAdjacentEventIds(
          frontier,
          [...visited],
          query.direction,
          filters,
          remaining,
        );
        nodes.push(...(await loadDiscoveredEvents(snapshot, nextIds)));
        for (const eventId of nextIds) visited.add(eventId);
        if (nextIds.length === remaining) {
          stopReason = 'node_limit';
          break;
        }
        frontier = nextIds;
      }

      const relations = sortRelations(
        await snapshot.findRelationsBetween(
          nodes.map((event) => event.id),
          filters,
        ),
      );
      return applyRelationLimit(nodes, relations, query, stopReason);
    });
  }
}
