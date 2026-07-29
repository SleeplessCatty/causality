import type { CausalPathEvent, CausalPathRelation } from '@causality/contracts';

export interface CausalPathFilters {
  minConfidence: number;
  minCaseCount: number;
}

export interface CausalPathSnapshot {
  findEvents(ids: string[]): Promise<CausalPathEvent[]>;
  findOutgoingRelations(
    causeEventIds: string[],
    filters: CausalPathFilters,
    limit: number,
  ): Promise<CausalPathRelation[]>;
}

export interface CausalPathRepository {
  withSnapshot<T>(operation: (snapshot: CausalPathSnapshot) => Promise<T>): Promise<T>;
}
