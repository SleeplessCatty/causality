import type {
  CausalEvidenceBundleInput,
  CausalEvidenceBundleResponse,
  CausalEvidenceRelation,
  CausalPathEvent,
} from '@causality/contracts';

import type {
  CausalEvidenceBundleRepository,
  CausalEvidenceBundleSnapshot,
  EvidenceRelationRecord,
} from './causalEvidenceBundleTypes.js';

export type CausalEvidenceBundleErrorCode =
  'EVIDENCE_RELATION_NOT_FOUND' | 'EVIDENCE_PATH_INVALID' | 'EVIDENCE_PATH_CYCLE';

export class CausalEvidenceBundleServiceError extends Error {
  public readonly suggestedAction: string;

  public constructor(
    public readonly code: CausalEvidenceBundleErrorCode,
    public readonly relationId: string,
    public readonly relationIndex: number,
  ) {
    const definition =
      code === 'EVIDENCE_RELATION_NOT_FOUND'
        ? {
            message: '证据包中的因果关系不存在',
            suggestedAction: '重新查询路径并使用当前存在的关系',
          }
        : code === 'EVIDENCE_PATH_CYCLE'
          ? {
              message: '证据包路径形成循环',
              suggestedAction: '移除导致循环的关系并重新查询路径',
            }
          : {
              message: '证据包关系顺序不连续或路径数据已变化',
              suggestedAction: '重新查询路径或调整关系顺序',
            };
    super(definition.message);
    this.name = 'CausalEvidenceBundleServiceError';
    this.suggestedAction = definition.suggestedAction;
  }
}

function orderedRelations(
  input: CausalEvidenceBundleInput,
  records: EvidenceRelationRecord[],
): EvidenceRelationRecord[] {
  const byId = new Map(records.map((record) => [record.id, record]));
  return input.relationIds.map((relationId, relationIndex) => {
    const record = byId.get(relationId);
    if (!record) {
      throw new CausalEvidenceBundleServiceError(
        'EVIDENCE_RELATION_NOT_FOUND',
        relationId,
        relationIndex,
      );
    }
    return record;
  });
}

function validatePath(relations: EvidenceRelationRecord[]): CausalPathEvent[] {
  const first = relations[0]!;
  const events = [first.causeEvent];
  const visitedEventIds = new Set([first.causeEvent.id]);

  relations.forEach((relation, relationIndex) => {
    const previousEvent = events.at(-1)!;
    if (relation.causeEvent.id !== previousEvent.id) {
      throw new CausalEvidenceBundleServiceError(
        'EVIDENCE_PATH_INVALID',
        relation.id,
        relationIndex,
      );
    }
    if (visitedEventIds.has(relation.effectEvent.id)) {
      throw new CausalEvidenceBundleServiceError('EVIDENCE_PATH_CYCLE', relation.id, relationIndex);
    }
    events.push(relation.effectEvent);
    visitedEventIds.add(relation.effectEvent.id);
  });

  return events;
}

async function buildRelations(
  snapshot: CausalEvidenceBundleSnapshot,
  input: CausalEvidenceBundleInput,
  relations: EvidenceRelationRecord[],
): Promise<CausalEvidenceRelation[]> {
  const caseGroups = await snapshot.findCasesByRelationIds(
    input.relationIds,
    input.caseLimitPerRelation,
  );
  const casesByRelation = new Map(caseGroups.map((group) => [group.relationId, group]));

  return relations.map((relation) => {
    const group = casesByRelation.get(relation.id);
    const caseCount = group?.totalCount ?? 0;
    const cases = (group?.cases ?? []).slice(0, input.caseLimitPerRelation);
    return {
      id: relation.id,
      causeEventId: relation.causeEvent.id,
      effectEventId: relation.effectEvent.id,
      description: relation.description,
      confidence: relation.confidence,
      caseCount,
      cases,
      returnedCaseCount: cases.length,
      casesTruncated: caseCount > cases.length,
      evidenceStatus: caseCount === 0 ? 'no_cases' : 'supported',
    };
  });
}

export class CausalEvidenceBundleService {
  public constructor(private readonly repository: CausalEvidenceBundleRepository) {}

  public build(input: CausalEvidenceBundleInput): Promise<CausalEvidenceBundleResponse> {
    return this.repository.withSnapshot(async (snapshot) => {
      const records = await snapshot.findRelations(input.relationIds);
      const relations = orderedRelations(input, records);
      const events = validatePath(relations);
      const evidenceRelations = await buildRelations(snapshot, input, relations);

      return {
        events,
        relations: evidenceRelations,
        hopCount: evidenceRelations.length,
        minimumConfidence: Math.min(...evidenceRelations.map((relation) => relation.confidence)),
        totalCaseCount: evidenceRelations.reduce(
          (total, relation) => total + relation.caseCount,
          0,
        ),
      };
    });
  }
}
