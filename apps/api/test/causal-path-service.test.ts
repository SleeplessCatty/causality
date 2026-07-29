import type { CausalPathEvent, CausalPathQuery, CausalPathRelation } from '@causality/contracts';
import { describe, expect, it } from 'vitest';

import type {
  CausalPathFilters,
  CausalPathRepository,
  CausalPathSnapshot,
} from '../src/features/causal-evidence/causalPathTypes.js';
import { CausalPathService } from '../src/features/causal-evidence/causalPathService.js';
import type { CausalPathServiceError } from '../src/features/causal-evidence/causalPathService.js';

function uuid(prefix: string, index: number): string {
  return prefix + String(index).padStart(12, '0');
}

const eventIds = Array.from({ length: 10_020 }, (_, index) =>
  uuid('10000000-0000-4000-8000-', index + 1),
);
const relationIds = Array.from({ length: 10_020 }, (_, index) =>
  uuid('20000000-0000-4000-8000-', index + 1),
);
const [eventAId, eventBId, eventCId, eventDId] = eventIds as [
  string,
  string,
  string,
  string,
  ...string[],
];

function event(id: string): CausalPathEvent {
  return { id, name: '事件-' + id.slice(-4) };
}

function relation(
  index: number,
  causeEventId: string,
  effectEventId: string,
  confidence = 50,
  caseCount = 0,
): CausalPathRelation {
  return {
    id: relationIds[index]!,
    causeEventId,
    effectEventId,
    confidence,
    caseCount,
  };
}

function query(overrides: Partial<CausalPathQuery> = {}): CausalPathQuery {
  return {
    sourceEventId: eventAId,
    targetEventId: eventCId,
    maxDepth: 5,
    pathLimit: 10,
    minConfidence: 0,
    minCaseCount: 0,
    ...overrides,
  };
}

class MemorySnapshot implements CausalPathSnapshot {
  readonly outgoingCalls: string[][] = [];
  readonly outgoingLimits: number[] = [];
  readonly eventCalls: string[][] = [];

  constructor(
    private readonly events: CausalPathEvent[],
    private readonly relations: CausalPathRelation[],
  ) {}

  async findEvents(ids: string[]): Promise<CausalPathEvent[]> {
    this.eventCalls.push([...ids]);
    const requested = new Set(ids);
    return this.events.filter((item) => requested.has(item.id)).reverse();
  }

  async findOutgoingRelations(
    causeEventIds: string[],
    filters: CausalPathFilters,
    limit = Number.MAX_SAFE_INTEGER,
  ): Promise<CausalPathRelation[]> {
    this.outgoingCalls.push([...causeEventIds]);
    this.outgoingLimits.push(limit);
    const causes = new Set(causeEventIds);
    return this.relations
      .filter(
        (item) =>
          causes.has(item.causeEventId) &&
          item.confidence >= filters.minConfidence &&
          item.caseCount >= filters.minCaseCount,
      )
      .reverse()
      .slice(0, limit);
  }
}

class MemoryRepository implements CausalPathRepository {
  constructor(readonly snapshot: MemorySnapshot) {}

  withSnapshot<T>(operation: (snapshot: CausalPathSnapshot) => Promise<T>): Promise<T> {
    return operation(this.snapshot);
  }
}

function setup(
  events: CausalPathEvent[],
  relations: CausalPathRelation[],
): { service: CausalPathService; snapshot: MemorySnapshot } {
  const snapshot = new MemorySnapshot(events, relations);
  return {
    service: new CausalPathService(new MemoryRepository(snapshot)),
    snapshot,
  };
}

describe('CausalPathService', () => {
  it('returns direct and multi-hop paths in true causal direction', async () => {
    const graph = setup([eventAId, eventBId, eventCId].map(event), [
      relation(0, eventAId, eventCId, 30, 1),
      relation(1, eventAId, eventBId, 80, 2),
      relation(2, eventBId, eventCId, 60, 3),
    ]);

    const result = await graph.service.query(query());

    expect(result.paths.map((path) => path.events.map((item) => item.id))).toEqual([
      [eventAId, eventCId],
      [eventAId, eventBId, eventCId],
    ]);
    expect(result.paths[1]).toMatchObject({
      hopCount: 2,
      minimumConfidence: 60,
      totalCaseCount: 5,
    });
    expect(graph.snapshot.outgoingCalls).toEqual([[eventAId], [eventBId]]);
  });

  it('does not reverse edges or repeat events in a cycle', async () => {
    const graph = setup([eventAId, eventBId, eventCId].map(event), [
      relation(0, eventBId, eventAId),
      relation(1, eventAId, eventBId),
      relation(2, eventBId, eventAId),
      relation(3, eventBId, eventCId),
    ]);

    const forward = await graph.service.query(query());
    const reverse = await graph.service.query(
      query({ sourceEventId: eventCId, targetEventId: eventAId }),
    );

    expect(forward.paths).toHaveLength(1);
    expect(forward.paths[0]?.events.map((item) => item.id)).toEqual([eventAId, eventBId, eventCId]);
    expect(reverse.paths).toEqual([]);
  });

  it('applies confidence and case filters through every frontier batch', async () => {
    const graph = setup([eventAId, eventBId, eventCId, eventDId].map(event), [
      relation(0, eventAId, eventBId, 70, 2),
      relation(1, eventBId, eventCId, 69, 2),
      relation(2, eventAId, eventDId, 90, 0),
      relation(3, eventDId, eventCId, 90, 4),
    ]);

    const result = await graph.service.query(query({ minConfidence: 70, minCaseCount: 1 }));

    expect(result.paths).toEqual([]);
    expect(graph.snapshot.outgoingCalls).toEqual([[eventAId], [eventBId]]);
  });

  it('sorts equal-hop paths by cases, minimum confidence, then relation ids', async () => {
    const middleIds = eventIds.slice(3, 7);
    const graph = setup(
      [event(eventAId), event(eventCId), ...middleIds.map(event)],
      [
        relation(7, eventAId, middleIds[0]!, 90, 2),
        relation(8, middleIds[0]!, eventCId, 50, 2),
        relation(5, eventAId, middleIds[1]!, 60, 3),
        relation(6, middleIds[1]!, eventCId, 60, 3),
        relation(3, eventAId, middleIds[2]!, 70, 3),
        relation(4, middleIds[2]!, eventCId, 70, 3),
        relation(1, eventAId, middleIds[3]!, 70, 3),
        relation(2, middleIds[3]!, eventCId, 70, 3),
      ],
    );

    const result = await graph.service.query(query());

    expect(result.paths.map((path) => path.events[1]?.id)).toEqual([
      middleIds[3],
      middleIds[2],
      middleIds[1],
      middleIds[0],
    ]);
  });

  it('returns the requested number and reports possible deeper truncation', async () => {
    const middleIds = eventIds.slice(3, 15);
    const relations = middleIds.flatMap((middleId, index) => [
      relation(index * 2, eventAId, middleId, 50, 1),
      relation(index * 2 + 1, middleId, eventCId, 50, 1),
    ]);
    const graph = setup([event(eventAId), event(eventCId), ...middleIds.map(event)], relations);

    const result = await graph.service.query(query({ pathLimit: 10 }));

    expect(result.paths).toHaveLength(10);
    expect(result.truncated).toBe(true);
    expect(result.truncatedReason).toBe('path_limit');
  });

  it('stops after exactly 10000 expanded states', async () => {
    const branchIds = eventIds.slice(2, 10_003);
    const graph = setup(
      [event(eventAId), event(eventBId), ...branchIds.map(event)],
      branchIds.map((branchId, index) => relation(index, eventAId, branchId)),
    );

    const result = await graph.service.query(query({ targetEventId: eventBId, maxDepth: 1 }));

    expect(result.paths).toEqual([]);
    expect(result.expandedStateCount).toBe(10_000);
    expect(result.truncated).toBe(true);
    expect(result.truncatedReason).toBe('expansion_limit');
    expect(graph.snapshot.outgoingLimits).toEqual([10_001]);
  });

  it.each([
    { missingId: eventAId, endpoint: 'source' },
    { missingId: eventCId, endpoint: 'target' },
  ] as const)('reports a missing $endpoint endpoint', async ({ missingId, endpoint }) => {
    const graph = setup([eventAId, eventCId].filter((id) => id !== missingId).map(event), []);

    await expect(graph.service.query(query())).rejects.toMatchObject({
      name: 'CausalPathServiceError',
      code: 'EVENT_NOT_FOUND',
      endpoint,
      eventId: missingId,
    } satisfies Partial<CausalPathServiceError>);
  });
});
