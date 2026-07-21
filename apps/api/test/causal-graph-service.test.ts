import type { CausalGraphNode, CausalGraphQuery, CausalGraphRelation } from '@causality/contracts';
import { describe, expect, it } from 'vitest';

import type {
  CausalGraphFilters,
  CausalGraphRepository,
  CausalGraphSnapshot,
} from '../src/features/causal-graph/causalGraphTypes.js';
import {
  CausalGraphService,
  CausalGraphServiceError,
} from '../src/features/causal-graph/causalGraphService.js';

const ids = Array.from(
  { length: 110 },
  (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
);
const centerId = ids[0]!;

function node(id: string): CausalGraphNode {
  return { id, name: `事件-${id.slice(-4)}` };
}

function relation(
  index: number,
  causeEventId: string,
  effectEventId: string,
  confidence: number,
  caseCount: number,
): CausalGraphRelation {
  return {
    id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    causeEventId,
    effectEventId,
    confidence,
    caseCount,
  };
}

function query(overrides: Partial<CausalGraphQuery> = {}): CausalGraphQuery {
  return {
    centerEventId: centerId,
    direction: 'downstream',
    limit: 20,
    minConfidence: 0,
    minCaseCount: 0,
    ...overrides,
  };
}

class MemorySnapshot implements CausalGraphSnapshot {
  readonly frontierCalls: string[][] = [];
  readonly filterCalls: CausalGraphFilters[] = [];

  constructor(
    private readonly events: CausalGraphNode[],
    private readonly relations: CausalGraphRelation[],
  ) {}

  async findEvent(id: string): Promise<CausalGraphNode | null> {
    return this.events.find((event) => event.id === id) ?? null;
  }

  async findEvents(eventIds: string[]): Promise<CausalGraphNode[]> {
    return this.events.filter((event) => eventIds.includes(event.id)).reverse();
  }

  async findAdjacentRelations(
    eventIds: string[],
    direction: CausalGraphQuery['direction'],
    filters: CausalGraphFilters,
  ): Promise<CausalGraphRelation[]> {
    this.frontierCalls.push([...eventIds]);
    this.filterCalls.push({ ...filters });
    return this.filtered(filters)
      .filter((edge) => {
        if (direction === 'upstream') return eventIds.includes(edge.effectEventId);
        if (direction === 'downstream') return eventIds.includes(edge.causeEventId);
        return eventIds.includes(edge.causeEventId) || eventIds.includes(edge.effectEventId);
      })
      .reverse();
  }

  async findRelationsBetween(
    eventIds: string[],
    filters: CausalGraphFilters,
  ): Promise<CausalGraphRelation[]> {
    this.filterCalls.push({ ...filters });
    return this.filtered(filters)
      .filter(
        (edge) => eventIds.includes(edge.causeEventId) && eventIds.includes(edge.effectEventId),
      )
      .reverse();
  }

  private filtered(filters: CausalGraphFilters): CausalGraphRelation[] {
    return this.relations.filter(
      (edge) => edge.confidence >= filters.minConfidence && edge.caseCount >= filters.minCaseCount,
    );
  }
}

class MemoryRepository implements CausalGraphRepository {
  constructor(readonly snapshot: MemorySnapshot) {}

  withSnapshot<T>(operation: (snapshot: CausalGraphSnapshot) => Promise<T>): Promise<T> {
    return operation(this.snapshot);
  }
}

function service(
  events: CausalGraphNode[],
  relations: CausalGraphRelation[],
): { service: CausalGraphService; snapshot: MemorySnapshot } {
  const snapshot = new MemorySnapshot(events, relations);
  return { service: new CausalGraphService(new MemoryRepository(snapshot)), snapshot };
}

describe('CausalGraphService', () => {
  it('discovers by layer and sorts same-layer candidates deterministically', async () => {
    const highCases = ids[1]!;
    const highConfidence = ids[2]!;
    const low = ids[3]!;
    const setup = service([centerId, highCases, highConfidence, low].map(node), [
      relation(3, centerId, low, 80, 10),
      relation(2, centerId, highConfidence, 90, 1),
      relation(1, centerId, highCases, 90, 3),
    ]);

    const graph = await setup.service.query(query());

    expect(graph.nodes.map((event) => event.id)).toEqual([
      centerId,
      highCases,
      highConfidence,
      low,
    ]);
    expect(setup.snapshot.frontierCalls).toEqual([[centerId], [highCases, highConfidence, low]]);
    expect(graph.meta.stopReason).toBe('exhausted');
  });

  it('traverses upstream relations', async () => {
    const upstream = ids[1]!;
    const setup = service([centerId, upstream].map(node), [relation(0, upstream, centerId, 70, 0)]);

    const graph = await setup.service.query(query({ direction: 'upstream' }));

    expect(graph.nodes.map((event) => event.id)).toEqual([centerId, upstream]);
  });

  it('uses one queue for both directions and de-duplicates cycles', async () => {
    const upstream = ids[1]!;
    const downstream = ids[2]!;
    const setup = service([centerId, upstream, downstream].map(node), [
      relation(0, upstream, centerId, 90, 0),
      relation(1, centerId, downstream, 80, 0),
      relation(2, downstream, centerId, 70, 0),
    ]);

    const graph = await setup.service.query(query({ direction: 'both' }));

    expect(graph.nodes.map((event) => event.id)).toEqual([centerId, upstream, downstream]);
    expect(new Set(graph.nodes.map((event) => event.id)).size).toBe(graph.nodes.length);
    expect(graph.relations).toHaveLength(3);
  });

  it('stops at the requested non-center node limit without querying another layer', async () => {
    const relatedIds = ids.slice(1, 22);
    const setup = service(
      [centerId, ...relatedIds].map(node),
      relatedIds.map((id, index) => relation(index, centerId, id, 100 - index, 0)),
    );

    const graph = await setup.service.query(query({ limit: 20 }));

    expect(graph.nodes).toHaveLength(21);
    expect(graph.meta.stopReason).toBe('node_limit');
    expect(setup.snapshot.frontierCalls).toEqual([[centerId]]);
  });

  it('returns all filtered relations between selected nodes regardless of traversal direction', async () => {
    const first = ids[1]!;
    const second = ids[2]!;
    const edges = [
      relation(0, centerId, first, 90, 0),
      relation(1, first, centerId, 80, 0),
      relation(2, centerId, second, 70, 0),
      relation(3, first, second, 60, 0),
    ];
    const setup = service([centerId, first, second].map(node), edges);

    const graph = await setup.service.query(query({ direction: 'downstream' }));

    expect(graph.relations.map((edge) => edge.id)).toEqual(edges.map((edge) => edge.id));
  });

  it('forwards filters to traversal and complete-relation queries', async () => {
    const included = ids[1]!;
    const excluded = ids[2]!;
    const setup = service([centerId, included, excluded].map(node), [
      relation(0, centerId, included, 80, 2),
      relation(1, centerId, excluded, 79, 5),
      relation(2, centerId, excluded, 90, 1),
    ]);

    const graph = await setup.service.query(query({ minConfidence: 80, minCaseCount: 2 }));

    expect(graph.nodes.map((event) => event.id)).toEqual([centerId, included]);
    expect(setup.snapshot.filterCalls).toEqual([
      { minConfidence: 80, minCaseCount: 2 },
      { minConfidence: 80, minCaseCount: 2 },
      { minConfidence: 80, minCaseCount: 2 },
    ]);
  });

  it('shrinks to the largest stable node prefix when complete relations exceed the cap', async () => {
    const relatedIds = ids.slice(1, 21);
    let index = 0;
    const edges: CausalGraphRelation[] = [];
    const allIds = [centerId, ...relatedIds];
    for (const cause of allIds) {
      for (const effect of allIds) {
        if (cause !== effect) edges.push(relation(index++, cause, effect, 80, 0));
      }
    }
    const setup = service(allIds.map(node), edges);

    const graph = await setup.service.query(query({ limit: 20 }));

    expect(graph.nodes).toHaveLength(14);
    expect(graph.relations).toHaveLength(182);
    expect(graph.meta).toMatchObject({
      stopReason: 'relation_limit',
      relationLimit: 200,
      nodeCount: 14,
      relationCount: 182,
    });
    const returnedIds = new Set(graph.nodes.map((event) => event.id));
    expect(
      graph.relations.every(
        (edge) => returnedIds.has(edge.causeEventId) && returnedIds.has(edge.effectEventId),
      ),
    ).toBe(true);
  });

  it.each([
    [50, 500],
    [100, 1_000],
  ] as const)('maps node limit %i to relation limit %i', async (limit, relationLimit) => {
    const setup = service([node(centerId)], []);

    const graph = await setup.service.query(query({ limit }));

    expect(graph.meta).toMatchObject({ relationLimit, stopReason: 'exhausted' });
  });

  it('returns an isolated center and rejects a missing center', async () => {
    const isolated = service([node(centerId)], []);
    await expect(isolated.service.query(query())).resolves.toMatchObject({
      nodes: [node(centerId)],
      relations: [],
      meta: { nodeCount: 1, relationCount: 0, stopReason: 'exhausted' },
    });

    const missing = service([], []);
    await expect(missing.service.query(query())).rejects.toBeInstanceOf(CausalGraphServiceError);
    await expect(missing.service.query(query())).rejects.toMatchObject({
      code: 'EVENT_NOT_FOUND',
    });
  });

  it('does not hide snapshot transaction failures', async () => {
    const failure = new Error('snapshot unavailable');
    const repository: CausalGraphRepository = {
      withSnapshot: async () => {
        throw failure;
      },
    };

    await expect(new CausalGraphService(repository).query(query())).rejects.toBe(failure);
  });
});
