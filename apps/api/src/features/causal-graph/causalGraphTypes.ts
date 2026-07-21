import type { CausalGraphNode, CausalGraphQuery, CausalGraphRelation } from '@causality/contracts';

export interface CausalGraphFilters {
  minConfidence: number;
  minCaseCount: number;
}

export interface CausalGraphSnapshot {
  findEvent(id: string): Promise<CausalGraphNode | null>;
  findEvents(ids: string[]): Promise<CausalGraphNode[]>;
  findAdjacentRelations(
    eventIds: string[],
    direction: CausalGraphQuery['direction'],
    filters: CausalGraphFilters,
  ): Promise<CausalGraphRelation[]>;
  findRelationsBetween(
    eventIds: string[],
    filters: CausalGraphFilters,
  ): Promise<CausalGraphRelation[]>;
}

export interface CausalGraphRepository {
  withSnapshot<T>(operation: (snapshot: CausalGraphSnapshot) => Promise<T>): Promise<T>;
}
