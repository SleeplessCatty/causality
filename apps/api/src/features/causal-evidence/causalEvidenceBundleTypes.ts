import type { CausalEvidenceCase, CausalPathEvent } from '@causality/contracts';

export interface EvidenceRelationRecord {
  id: string;
  causeEvent: CausalPathEvent;
  effectEvent: CausalPathEvent;
  description: string | null;
  confidence: number;
}

export interface EvidenceCasesByRelation {
  relationId: string;
  totalCount: number;
  cases: CausalEvidenceCase[];
}

export interface CausalEvidenceBundleSnapshot {
  findRelations(ids: string[]): Promise<EvidenceRelationRecord[]>;
  findCasesByRelationIds(
    ids: string[],
    limitPerRelation: number,
  ): Promise<EvidenceCasesByRelation[]>;
}

export interface CausalEvidenceBundleRepository {
  withSnapshot<T>(operation: (snapshot: CausalEvidenceBundleSnapshot) => Promise<T>): Promise<T>;
}
