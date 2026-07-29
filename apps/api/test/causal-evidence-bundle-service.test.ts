import type { CausalEvidenceBundleInput, CausalPathEvent } from '@causality/contracts';
import { describe, expect, it } from 'vitest';

import type {
  CausalEvidenceBundleRepository,
  CausalEvidenceBundleSnapshot,
  EvidenceCasesByRelation,
  EvidenceRelationRecord,
} from '../src/features/causal-evidence/causalEvidenceBundleTypes.js';
import { CausalEvidenceBundleService } from '../src/features/causal-evidence/causalEvidenceBundleService.js';
import type { CausalEvidenceBundleServiceError } from '../src/features/causal-evidence/causalEvidenceBundleService.js';

const eventA: CausalPathEvent = {
  id: '10000000-0000-4000-8000-000000000001',
  name: '事件 A',
};
const eventB: CausalPathEvent = {
  id: '10000000-0000-4000-8000-000000000002',
  name: '事件 B',
};
const eventC: CausalPathEvent = {
  id: '10000000-0000-4000-8000-000000000003',
  name: '事件 C',
};
const relationAId = '20000000-0000-4000-8000-000000000001';
const relationBId = '20000000-0000-4000-8000-000000000002';
const relationBackId = '20000000-0000-4000-8000-000000000003';
const caseId = '30000000-0000-4000-8000-000000000001';
const linkedAt = '2026-07-30T03:00:00.000Z';

function relation(
  id: string,
  causeEvent: CausalPathEvent,
  effectEvent: CausalPathEvent,
  confidence: number,
  description: string | null = null,
): EvidenceRelationRecord {
  return { id, causeEvent, effectEvent, confidence, description };
}

const relationAB = relation(relationAId, eventA, eventB, 60, 'A 导致 B');
const relationBC = relation(relationBId, eventB, eventC, 40);
const relationBA = relation(relationBackId, eventB, eventA, 30);

class MemorySnapshot implements CausalEvidenceBundleSnapshot {
  readonly caseCalls: Array<{ ids: string[]; limit: number }> = [];

  constructor(
    private readonly relations: EvidenceRelationRecord[],
    private readonly casesByRelation: EvidenceCasesByRelation[],
  ) {}

  async findRelations(ids: string[]): Promise<EvidenceRelationRecord[]> {
    const requested = new Set(ids);
    return this.relations.filter((item) => requested.has(item.id)).reverse();
  }

  async findCasesByRelationIds(
    ids: string[],
    limitPerRelation: number,
  ): Promise<EvidenceCasesByRelation[]> {
    this.caseCalls.push({ ids: [...ids], limit: limitPerRelation });
    const requested = new Set(ids);
    return this.casesByRelation
      .filter((item) => requested.has(item.relationId))
      .map((item) => ({
        ...item,
        cases: item.cases.slice(0, limitPerRelation),
      }))
      .reverse();
  }
}

class MemoryRepository implements CausalEvidenceBundleRepository {
  constructor(readonly snapshot: MemorySnapshot) {}

  withSnapshot<T>(operation: (snapshot: CausalEvidenceBundleSnapshot) => Promise<T>): Promise<T> {
    return operation(this.snapshot);
  }
}

function setup(
  relations: EvidenceRelationRecord[] = [relationAB, relationBC],
  casesByRelation: EvidenceCasesByRelation[] = [
    {
      relationId: relationAId,
      totalCount: 2,
      cases: [
        {
          id: caseId,
          content: '事件 A 发生后事件 B 随后发生',
          linkedAt,
        },
      ],
    },
  ],
): { service: CausalEvidenceBundleService; snapshot: MemorySnapshot } {
  const snapshot = new MemorySnapshot(relations, casesByRelation);
  return {
    service: new CausalEvidenceBundleService(new MemoryRepository(snapshot)),
    snapshot,
  };
}

function input(relationIds: string[] = [relationAId, relationBId]): CausalEvidenceBundleInput {
  return { relationIds, caseLimitPerRelation: 5 };
}

describe('CausalEvidenceBundleService', () => {
  it('rebuilds input order and returns readable supported and no-case evidence', async () => {
    const context = setup();

    const result = await context.service.build(input());

    expect(result.events).toEqual([eventA, eventB, eventC]);
    expect(result).toMatchObject({
      hopCount: 2,
      minimumConfidence: 40,
      totalCaseCount: 2,
    });
    expect(result.relations[0]).toMatchObject({
      id: relationAId,
      description: 'A 导致 B',
      caseCount: 2,
      returnedCaseCount: 1,
      casesTruncated: true,
      evidenceStatus: 'supported',
      cases: [{ id: caseId, linkedAt }],
    });
    expect(result.relations[1]).toMatchObject({
      id: relationBId,
      caseCount: 0,
      returnedCaseCount: 0,
      casesTruncated: false,
      evidenceStatus: 'no_cases',
      cases: [],
    });
    expect(context.snapshot.caseCalls).toEqual([{ ids: [relationAId, relationBId], limit: 5 }]);
  });

  it('reports the exact missing relation', async () => {
    const context = setup([relationAB]);
    const missingId = relationBId;

    await expect(context.service.build(input())).rejects.toMatchObject({
      name: 'CausalEvidenceBundleServiceError',
      code: 'EVIDENCE_RELATION_NOT_FOUND',
      relationId: missingId,
      relationIndex: 1,
    } satisfies Partial<CausalEvidenceBundleServiceError>);
  });

  it('rejects relation order that is not a continuous causal path', async () => {
    const context = setup();

    await expect(context.service.build(input([relationBId, relationAId]))).rejects.toMatchObject({
      code: 'EVIDENCE_PATH_INVALID',
      relationId: relationAId,
      relationIndex: 1,
      suggestedAction: '重新查询路径或调整关系顺序',
    } satisfies Partial<CausalEvidenceBundleServiceError>);
  });

  it('rejects a relation sequence that cycles back to a visited event', async () => {
    const context = setup([relationAB, relationBA], []);

    await expect(context.service.build(input([relationAId, relationBackId]))).rejects.toMatchObject(
      {
        code: 'EVIDENCE_PATH_CYCLE',
        relationId: relationBackId,
        relationIndex: 1,
      } satisfies Partial<CausalEvidenceBundleServiceError>,
    );
  });

  it('honors the requested per-relation case limit', async () => {
    const cases = Array.from({ length: 7 }, (_, index) => ({
      id: '30000000-0000-4000-8000-' + String(index + 1).padStart(12, '0'),
      content: '案例 ' + String(index + 1),
      linkedAt,
    }));
    const context = setup([relationAB], [{ relationId: relationAId, totalCount: 7, cases }]);

    const result = await context.service.build({
      relationIds: [relationAId],
      caseLimitPerRelation: 3,
    });

    expect(result.relations[0]).toMatchObject({
      caseCount: 7,
      returnedCaseCount: 3,
      casesTruncated: true,
    });
    expect(result.relations[0]?.cases).toHaveLength(3);
    expect(context.snapshot.caseCalls[0]).toEqual({
      ids: [relationAId],
      limit: 3,
    });
  });
});
