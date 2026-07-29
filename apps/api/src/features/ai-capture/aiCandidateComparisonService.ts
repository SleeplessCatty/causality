import { aiCaptureCandidateSetInputSchema, type AiCaptureComparison } from '@causality/contracts';

import {
  type AiCandidateComparisonRepository,
  type CaseMatchRow,
  type CaseRecord,
  type EventMatchRow,
  type EventRecord,
  type RelationMatch,
  type ResolvedLinkProbe,
  type ResolvedRelationProbe,
} from './aiCandidateComparisonRepository.js';
import { AiCaptureQualityBlockedError } from './aiCaptureErrors.js';
import {
  AiCaptureQualityGate,
  qualityReportFromZodError,
  uniqueExactMatchId,
} from './aiCaptureQualityGate.js';
import type { AiSemanticCandidateService, SemanticMatch } from './aiSemanticCandidateService.js';

const MAX_MATCHES = 10;

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function matchRank(matchKind: EventMatchRow['matchKind'] | CaseMatchRow['matchKind']): number {
  switch (matchKind) {
    case 'exact_name':
    case 'exact_content':
      return 1;
    case 'exact_alias':
      return 2;
    case 'fuzzy':
      return 3;
    case 'semantic':
      return 4;
  }
}

function mergeMatches<T extends EventMatchRow | CaseMatchRow>(
  normalMatches: readonly T[],
  semanticMatches: readonly SemanticMatch[],
  records: ReadonlyMap<string, EventRecord | CaseRecord>,
): T[] {
  const byId = new Map(normalMatches.map((match) => [match.id, match]));
  for (const semantic of semanticMatches) {
    if (byId.has(semantic.id)) continue;
    const record = records.get(semantic.id);
    if (!record) continue;
    byId.set(semantic.id, {
      ...record,
      matchKind: 'semantic',
      similarity: Math.max(0, Math.min(1, semantic.similarity)),
    } as T);
  }
  return [...byId.values()]
    .toSorted(
      (left, right) =>
        matchRank(left.matchKind) - matchRank(right.matchKind) ||
        (right.similarity ?? -1) - (left.similarity ?? -1) ||
        right.updatedAt.localeCompare(left.updatedAt) ||
        left.id.localeCompare(right.id),
    )
    .slice(0, MAX_MATCHES);
}

export class AiCandidateComparisonService {
  public constructor(
    private readonly repository: AiCandidateComparisonRepository,
    private readonly semantic: Pick<AiSemanticCandidateService, 'compare' | 'topicRelevance'>,
    private readonly qualityGate = new AiCaptureQualityGate(),
  ) {}

  public async compare(rawInput: unknown): Promise<AiCaptureComparison> {
    const parsed = aiCaptureCandidateSetInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new AiCaptureQualityBlockedError(
        'AI_CANDIDATE_QUALITY_BLOCKED',
        qualityReportFromZodError(rawInput, parsed.error),
      );
    }
    const input = parsed.data;
    const candidateReport = this.qualityGate.inspectCandidates(input);
    if (candidateReport.status === 'blocked') {
      throw new AiCaptureQualityBlockedError('AI_CANDIDATE_QUALITY_BLOCKED', candidateReport);
    }

    const [normalEvents, normalCases, semanticEvents, semanticCases, topicRelevance] =
      await Promise.all([
        this.repository.findEventMatches(input.atomicEvents),
        this.repository.findCaseMatches(input.concreteCases),
        this.semantic.compare(
          'event',
          input.atomicEvents.map((event) => event.name),
        ),
        this.semantic.compare(
          'case',
          input.concreteCases.map((concreteCase) => concreteCase.content),
        ),
        this.semantic.topicRelevance(input.topic, input.atomicEvents),
      ]);

    const semanticEventIds = unique(semanticEvents.flat().map((match) => match.id));
    const semanticCaseIds = unique(semanticCases.flat().map((match) => match.id));
    const [eventRecords, caseRecords] = await Promise.all([
      this.repository.findEventsByIds(semanticEventIds),
      this.repository.findCasesByIds(semanticCaseIds),
    ]);
    const eventRecordMap = new Map(eventRecords.map((record) => [record.id, record]));
    const caseRecordMap = new Map(caseRecords.map((record) => [record.id, record]));
    const mergedEvents = input.atomicEvents.map((_, index) =>
      mergeMatches(normalEvents[index] ?? [], semanticEvents[index] ?? [], eventRecordMap),
    );
    const mergedCases = input.concreteCases.map((_, index) =>
      mergeMatches(normalCases[index] ?? [], semanticCases[index] ?? [], caseRecordMap),
    );

    const eventMatchesByRef = new Map(
      input.atomicEvents.map((event, index) => [event.ref, mergedEvents[index] ?? []]),
    );
    const caseMatchesByRef = new Map(
      input.concreteCases.map((concreteCase, index) => [
        concreteCase.ref,
        mergedCases[index] ?? [],
      ]),
    );

    const relationProbes: ResolvedRelationProbe[] = [];
    for (const relation of input.causalRelations) {
      const causeEventId = uniqueExactMatchId(eventMatchesByRef.get(relation.causeEventRef) ?? []);
      const effectEventId = uniqueExactMatchId(
        eventMatchesByRef.get(relation.effectEventRef) ?? [],
      );
      if (causeEventId && effectEventId) {
        relationProbes.push({ ref: relation.ref, causeEventId, effectEventId });
      }
    }
    const relationMatches = await this.repository.findRelationMatches(relationProbes);
    const relationMatchByRef = this.preferredRelationMatches(relationMatches);

    const linkProbes: ResolvedLinkProbe[] = [];
    for (const link of input.relationCaseLinks) {
      const relationMatch = relationMatchByRef.get(link.relationRef);
      const caseId = uniqueExactMatchId(caseMatchesByRef.get(link.caseRef) ?? []);
      if (relationMatch?.direction === 'existing' && caseId) {
        linkProbes.push({
          relationRef: link.relationRef,
          relationId: relationMatch.relation.id,
          caseRef: link.caseRef,
          caseId,
        });
      }
    }
    const existingLinks = new Set(
      (await this.repository.findLinkMatches(linkProbes)).map(
        (link) => `${link.relationRef}\u0000${link.caseRef}`,
      ),
    );

    const comparison: AiCaptureComparison = {
      atomicEvents: input.atomicEvents.map((event) => ({
        ref: event.ref,
        matches: eventMatchesByRef.get(event.ref) ?? [],
      })),
      concreteCases: input.concreteCases.map((concreteCase) => ({
        ref: concreteCase.ref,
        matches: caseMatchesByRef.get(concreteCase.ref) ?? [],
      })),
      causalRelations: input.causalRelations.map((relation) => {
        const match = relationMatchByRef.get(relation.ref);
        return match
          ? { ref: relation.ref, status: match.direction, relation: match.relation }
          : { ref: relation.ref, status: 'missing' };
      }),
      relationCaseLinks: input.relationCaseLinks.map((link) => ({
        ...link,
        exists: existingLinks.has(`${link.relationRef}\u0000${link.caseRef}`),
      })),
      qualityReport: candidateReport,
    };

    return {
      ...comparison,
      qualityReport: this.qualityGate.inspectComparison({
        candidates: input,
        comparison,
        topicRelevance,
      }),
    };
  }

  private preferredRelationMatches(matches: readonly RelationMatch[]): Map<string, RelationMatch> {
    const byRef = new Map<string, RelationMatch>();
    for (const match of matches) {
      const current = byRef.get(match.ref);
      if (!current || (current.direction === 'reverse' && match.direction === 'existing')) {
        byRef.set(match.ref, match);
      }
    }
    return byRef;
  }
}
