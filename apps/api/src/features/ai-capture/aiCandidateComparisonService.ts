import {
  aiCaptureCandidateSetSchema,
  MAX_AI_CAPTURE_EVENTS,
  type AiCaptureCandidateSet,
  type AiCaptureComparison,
  type AtomicEventCandidate,
  type ConcreteCaseCandidate,
} from '@causality/contracts';

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
import { AiCaptureDataError } from './aiCaptureErrors.js';
import type { AiSemanticCandidateService, SemanticMatch } from './aiSemanticCandidateService.js';

const MAX_MATCHES = 10;

interface Group<T> {
  candidate: T;
  refs: string[];
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('zh-CN');
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function groupEvents(events: readonly AtomicEventCandidate[]): Group<AtomicEventCandidate>[] {
  const groups = new Map<string, Group<AtomicEventCandidate>>();
  for (const event of events) {
    const key = normalize(event.name);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { candidate: event, refs: [event.ref] });
      continue;
    }
    existing.refs.push(event.ref);
    existing.candidate = {
      ...existing.candidate,
      aliases: unique([...existing.candidate.aliases, ...event.aliases]),
      keywords: unique([...existing.candidate.keywords, ...event.keywords]),
    };
  }
  return [...groups.values()];
}

function groupCases(cases: readonly ConcreteCaseCandidate[]): Group<ConcreteCaseCandidate>[] {
  const groups = new Map<string, Group<ConcreteCaseCandidate>>();
  for (const concreteCase of cases) {
    const key = concreteCase.content.trim();
    const existing = groups.get(key);
    if (existing) {
      existing.refs.push(concreteCase.ref);
    } else {
      groups.set(key, { candidate: concreteCase, refs: [concreteCase.ref] });
    }
  }
  return [...groups.values()];
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

function exactIdentity(matches: readonly EventMatchRow[] | readonly CaseMatchRow[]): string | null {
  const exactIds = unique(
    matches
      .filter(
        (match) =>
          match.matchKind === 'exact_name' ||
          match.matchKind === 'exact_alias' ||
          match.matchKind === 'exact_content',
      )
      .map((match) => match.id),
  );
  return exactIds.length === 1 ? exactIds[0]! : null;
}

export class AiCandidateComparisonService {
  public constructor(
    private readonly repository: AiCandidateComparisonRepository,
    private readonly semantic: Pick<AiSemanticCandidateService, 'compare'>,
  ) {}

  public async compare(rawInput: AiCaptureCandidateSet): Promise<AiCaptureComparison> {
    this.assertDependencies(rawInput);
    const parsed = aiCaptureCandidateSetSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new AiCaptureDataError(
        'AI_CANDIDATE_INVALID',
        this.issueRefs(
          rawInput,
          parsed.error.issues.map((issue) => issue.path),
        ),
      );
    }
    const input = parsed.data;
    const eventGroups = groupEvents(input.atomicEvents);
    const caseGroups = groupCases(input.concreteCases);
    const eventCandidates = eventGroups.map((group) => group.candidate);
    const caseCandidates = caseGroups.map((group) => group.candidate);

    const [normalEvents, normalCases, semanticEvents, semanticCases] = await Promise.all([
      this.repository.findEventMatches(eventCandidates),
      this.repository.findCaseMatches(caseCandidates),
      this.semantic.compare(
        'event',
        eventCandidates.map((event) => event.name),
      ),
      this.semantic.compare(
        'case',
        caseCandidates.map((concreteCase) => concreteCase.content),
      ),
    ]);

    const semanticEventIds = unique(semanticEvents.flat().map((match) => match.id));
    const semanticCaseIds = unique(semanticCases.flat().map((match) => match.id));
    const [eventRecords, caseRecords] = await Promise.all([
      this.repository.findEventsByIds(semanticEventIds),
      this.repository.findCasesByIds(semanticCaseIds),
    ]);
    const eventRecordMap = new Map(eventRecords.map((record) => [record.id, record]));
    const caseRecordMap = new Map(caseRecords.map((record) => [record.id, record]));
    const mergedEvents = eventGroups.map((_, index) =>
      mergeMatches(normalEvents[index] ?? [], semanticEvents[index] ?? [], eventRecordMap),
    );
    const mergedCases = caseGroups.map((_, index) =>
      mergeMatches(normalCases[index] ?? [], semanticCases[index] ?? [], caseRecordMap),
    );

    const eventMatchesByRef = new Map<string, EventMatchRow[]>();
    eventGroups.forEach((group, index) => {
      for (const ref of group.refs) eventMatchesByRef.set(ref, mergedEvents[index] ?? []);
    });
    const caseMatchesByRef = new Map<string, CaseMatchRow[]>();
    caseGroups.forEach((group, index) => {
      for (const ref of group.refs) caseMatchesByRef.set(ref, mergedCases[index] ?? []);
    });

    const relationProbes: ResolvedRelationProbe[] = [];
    for (const relation of input.causalRelations) {
      const causeEventId = exactIdentity(eventMatchesByRef.get(relation.causeEventRef) ?? []);
      const effectEventId = exactIdentity(eventMatchesByRef.get(relation.effectEventRef) ?? []);
      if (causeEventId && effectEventId) {
        relationProbes.push({ ref: relation.ref, causeEventId, effectEventId });
      }
    }
    const relationMatches = await this.repository.findRelationMatches(relationProbes);
    const relationMatchByRef = this.preferredRelationMatches(relationMatches);

    const linkProbes: ResolvedLinkProbe[] = [];
    for (const link of input.relationCaseLinks) {
      const relationMatch = relationMatchByRef.get(link.relationRef);
      const caseId = exactIdentity(caseMatchesByRef.get(link.caseRef) ?? []);
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

    return {
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
    };
  }

  private assertDependencies(input: AiCaptureCandidateSet): void {
    if (input.atomicEvents.length > MAX_AI_CAPTURE_EVENTS) {
      throw new AiCaptureDataError(
        'AI_EVENT_LIMIT_EXCEEDED',
        input.atomicEvents.slice(MAX_AI_CAPTURE_EVENTS).map((event) => event.ref),
      );
    }
    const eventRefs = new Set(input.atomicEvents.map((event) => event.ref));
    const caseRefs = new Set(input.concreteCases.map((concreteCase) => concreteCase.ref));
    const relationRefs = new Set(input.causalRelations.map((relation) => relation.ref));
    const affected: string[] = [];
    for (const relation of input.causalRelations) {
      const missing = [relation.causeEventRef, relation.effectEventRef].filter(
        (ref) => !eventRefs.has(ref),
      );
      if (missing.length > 0) affected.push(relation.ref, ...missing);
    }
    for (const link of input.relationCaseLinks) {
      if (!relationRefs.has(link.relationRef)) affected.push(link.relationRef);
      if (!caseRefs.has(link.caseRef)) affected.push(link.caseRef);
    }
    if (affected.length > 0) {
      throw new AiCaptureDataError('AI_CANDIDATE_DEPENDENCY_INVALID', unique(affected));
    }
  }

  private issueRefs(input: AiCaptureCandidateSet, paths: PropertyKey[][]): string[] {
    const refs: string[] = [];
    for (const path of paths) {
      const [section, index] = path;
      if (typeof index !== 'number') continue;
      if (section === 'atomicEvents') refs.push(input.atomicEvents[index]?.ref ?? '');
      if (section === 'concreteCases') refs.push(input.concreteCases[index]?.ref ?? '');
      if (section === 'causalRelations') refs.push(input.causalRelations[index]?.ref ?? '');
      if (section === 'relationCaseLinks') {
        const link = input.relationCaseLinks[index];
        if (link) refs.push(link.relationRef, link.caseRef);
      }
    }
    return unique(refs.filter(Boolean));
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
