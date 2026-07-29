import type {
  CausalPath,
  CausalPathEvent,
  CausalPathQuery,
  CausalPathRelation,
  CausalPathResponse,
  CausalPathTruncatedReason,
} from '@causality/contracts';

import type {
  CausalPathFilters,
  CausalPathRepository,
  CausalPathSnapshot,
} from './causalPathTypes.js';

const MAX_EXPANDED_STATES = 10_000;

interface PathState {
  events: CausalPathEvent[];
  relations: CausalPathRelation[];
  visitedEventIds: ReadonlySet<string>;
  minimumConfidence: number;
  totalCaseCount: number;
}

export class CausalPathServiceError extends Error {
  public readonly code = 'EVENT_NOT_FOUND';

  public constructor(
    public readonly endpoint: 'source' | 'target',
    public readonly eventId: string,
  ) {
    super(endpoint === 'source' ? '起点事件不存在' : '终点事件不存在');
    this.name = 'CausalPathServiceError';
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function relationSequence(state: PathState): string[] {
  return state.relations.map((relation) => relation.id);
}

function compareSequences(left: string[], right: string[]): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const result = compareText(left[index]!, right[index]!);
    if (result !== 0) return result;
  }
  return left.length - right.length;
}

function compareStates(left: PathState, right: PathState): number {
  return (
    left.relations.length - right.relations.length ||
    right.totalCaseCount - left.totalCaseCount ||
    right.minimumConfidence - left.minimumConfidence ||
    compareSequences(relationSequence(left), relationSequence(right))
  );
}

function compareFrontierStates(left: PathState, right: PathState): number {
  return compareSequences(relationSequence(left), relationSequence(right));
}

function compareRelations(left: CausalPathRelation, right: CausalPathRelation): number {
  return (
    compareText(left.causeEventId, right.causeEventId) ||
    compareText(left.id, right.id) ||
    compareText(left.effectEventId, right.effectEventId)
  );
}

function toPath(state: PathState): CausalPath {
  return {
    events: state.events,
    relations: state.relations,
    hopCount: state.relations.length,
    minimumConfidence: state.minimumConfidence,
    totalCaseCount: state.totalCaseCount,
  };
}

async function loadEndpoints(
  snapshot: CausalPathSnapshot,
  query: CausalPathQuery,
): Promise<{ sourceEvent: CausalPathEvent; targetEvent: CausalPathEvent }> {
  const events = await snapshot.findEvents([query.sourceEventId, query.targetEventId]);
  const byId = new Map(events.map((event) => [event.id, event]));
  const sourceEvent = byId.get(query.sourceEventId);
  if (!sourceEvent) throw new CausalPathServiceError('source', query.sourceEventId);
  const targetEvent = byId.get(query.targetEventId);
  if (!targetEvent) throw new CausalPathServiceError('target', query.targetEventId);
  return { sourceEvent, targetEvent };
}

async function loadEffectEvents(
  snapshot: CausalPathSnapshot,
  relations: CausalPathRelation[],
  knownEvents: Map<string, CausalPathEvent>,
): Promise<void> {
  const missingIds = [
    ...new Set(
      relations
        .map((relation) => relation.effectEventId)
        .filter((eventId) => !knownEvents.has(eventId)),
    ),
  ];
  if (missingIds.length === 0) return;

  for (const event of await snapshot.findEvents(missingIds)) {
    knownEvents.set(event.id, event);
  }
  const missingEventId = missingIds.find((eventId) => !knownEvents.has(eventId));
  if (missingEventId) {
    throw new Error('Path relation references missing event: ' + missingEventId);
  }
}

function adjacencyByCause(relations: CausalPathRelation[]): Map<string, CausalPathRelation[]> {
  const adjacency = new Map<string, CausalPathRelation[]>();
  for (const relation of [...relations].sort(compareRelations)) {
    const values = adjacency.get(relation.causeEventId);
    if (values) values.push(relation);
    else adjacency.set(relation.causeEventId, [relation]);
  }
  return adjacency;
}

export class CausalPathService {
  public constructor(private readonly repository: CausalPathRepository) {}

  public query(query: CausalPathQuery): Promise<CausalPathResponse> {
    return this.repository.withSnapshot(async (snapshot) => {
      const { sourceEvent, targetEvent } = await loadEndpoints(snapshot, query);
      const knownEvents = new Map<string, CausalPathEvent>([
        [sourceEvent.id, sourceEvent],
        [targetEvent.id, targetEvent],
      ]);
      const filters: CausalPathFilters = {
        minConfidence: query.minConfidence,
        minCaseCount: query.minCaseCount,
      };
      let frontier: PathState[] = [
        {
          events: [sourceEvent],
          relations: [],
          visitedEventIds: new Set([sourceEvent.id]),
          minimumConfidence: Number.POSITIVE_INFINITY,
          totalCaseCount: 0,
        },
      ];
      const completed: PathState[] = [];
      let expandedStateCount = 0;
      let expansionLimitReached = false;
      let pathLimitReached = false;

      for (let depth = 1; depth <= query.maxDepth && frontier.length > 0; depth += 1) {
        const causeEventIds = [...new Set(frontier.map((state) => state.events.at(-1)!.id))].sort(
          compareText,
        );
        const relationReadLimit = MAX_EXPANDED_STATES - expandedStateCount + 1;
        const relations = await snapshot.findOutgoingRelations(
          causeEventIds,
          filters,
          relationReadLimit,
        );
        await loadEffectEvents(snapshot, relations, knownEvents);
        const adjacency = adjacencyByCause(relations);
        const nextFrontier: PathState[] = [];

        outer: for (const state of [...frontier].sort(compareFrontierStates)) {
          const currentEventId = state.events.at(-1)!.id;
          for (const relation of adjacency.get(currentEventId) ?? []) {
            if (state.visitedEventIds.has(relation.effectEventId)) continue;
            if (expandedStateCount === MAX_EXPANDED_STATES) {
              expansionLimitReached = true;
              break outer;
            }

            const effectEvent = knownEvents.get(relation.effectEventId);
            if (!effectEvent) {
              throw new Error('Path relation references missing event: ' + relation.effectEventId);
            }
            expandedStateCount += 1;
            const nextState: PathState = {
              events: [...state.events, effectEvent],
              relations: [...state.relations, relation],
              visitedEventIds: new Set([...state.visitedEventIds, relation.effectEventId]),
              minimumConfidence: Math.min(state.minimumConfidence, relation.confidence),
              totalCaseCount: state.totalCaseCount + relation.caseCount,
            };

            if (relation.effectEventId === targetEvent.id) {
              completed.push(nextState);
            } else if (depth < query.maxDepth) {
              nextFrontier.push(nextState);
            }
          }
        }

        if (expansionLimitReached) break;
        if (completed.length >= query.pathLimit) {
          pathLimitReached = completed.length > query.pathLimit || nextFrontier.length > 0;
          break;
        }
        frontier = nextFrontier;
      }

      let truncatedReason: CausalPathTruncatedReason | null = null;
      if (expansionLimitReached) truncatedReason = 'expansion_limit';
      else if (pathLimitReached) truncatedReason = 'path_limit';

      return {
        sourceEvent,
        targetEvent,
        paths: completed.sort(compareStates).slice(0, query.pathLimit).map(toPath),
        truncated: truncatedReason !== null,
        truncatedReason,
        expandedStateCount,
      };
    });
  }
}
