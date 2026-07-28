import { createHash } from 'node:crypto';

import {
  prepareAiImportPlanInputSchema,
  type AiImportChangeCounts,
  type PrepareAiImportPlanInput,
} from '@causality/contracts';

import { AiCaptureDataError } from './aiCaptureErrors.js';
import { calculateAutomaticConfidence } from '../relations/relationConfidencePolicy.js';

export interface ExistingEventState {
  id: string;
  name: string;
  description: string | null;
  aliases: string[];
  keywords: string[];
  updatedAt: string;
}

export interface ExistingCaseState {
  id: string;
  content: string;
  updatedAt: string;
}

export interface ExistingRelationState {
  id: string;
  causeEventId: string;
  effectEventId: string;
  description: string | null;
  confidence: number;
  baselineConfidence: number;
  baselineCaseCount: number;
  caseIds: string[];
  updatedAt: string;
}

export interface ExistingLinkState {
  relationId: string;
  caseId: string;
  exists: boolean;
  linkedAt: string | null;
}

export interface AiImportPlanPreparationState {
  events: ExistingEventState[];
  cases: ExistingCaseState[];
  relations: ExistingRelationState[];
  links: ExistingLinkState[];
}

export interface PreparedEventCreate {
  ref: string;
  name: string;
  description: string | null;
  aliases: string[];
  keywords: string[];
}

export interface PreparedEventUpdate {
  ref: string;
  id: string;
  appendAliases: string[];
  appendKeywords: string[];
  oldDescription: string | null;
  newDescription: string | null;
}

export interface PreparedEventReuse {
  ref: string;
  id: string;
}

export interface PreparedCaseCreate {
  ref: string;
  content: string;
}

export interface PreparedCaseReuse {
  ref: string;
  id: string;
}

export type PreparedEventEndpoint =
  { kind: 'create'; ref: string } | { kind: 'existing'; id: string };

export interface PreparedRelationCreate {
  ref: string;
  causeEvent: PreparedEventEndpoint;
  effectEvent: PreparedEventEndpoint;
  description: string | null;
}

export interface PreparedRelationReuse {
  ref: string;
  id: string;
}

export interface PreparedLinkCreate {
  relationRef: string;
  caseRef: string;
}

export interface PreparedConfidenceChange {
  relationRef: string;
  relationId: string | null;
  oldConfidence: number;
  newConfidence: number;
  oldCaseCount: number;
  newCaseCount: number;
}

export interface PreparedSkippedItem {
  type: 'event' | 'case' | 'relation' | 'link';
  ref: string;
  reason: string;
}

export interface PreparedDependencyVersion {
  type: 'event' | 'case' | 'relation' | 'link';
  id: string;
  relatedId: string | null;
  fingerprint: string;
}

export interface PreparedMutationSet {
  createEvents: PreparedEventCreate[];
  updateEvents: PreparedEventUpdate[];
  reuseEvents: PreparedEventReuse[];
  createCases: PreparedCaseCreate[];
  reuseCases: PreparedCaseReuse[];
  createRelations: PreparedRelationCreate[];
  reuseRelations: PreparedRelationReuse[];
  createLinks: PreparedLinkCreate[];
  confidenceChanges: PreparedConfidenceChange[];
  skipped: PreparedSkippedItem[];
  dependencies: PreparedDependencyVersion[];
  summary: AiImportChangeCounts;
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('zh-CN');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function fingerprintDependency(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function linkKey(relationRef: string, caseRef: string): string {
  return `${relationRef}\u0000${caseRef}`;
}

function relationPairKey(cause: PreparedEventEndpoint, effect: PreparedEventEndpoint): string {
  return `${eventEndpointKey(cause)}\u0000${eventEndpointKey(effect)}`;
}

function eventEndpointKey(endpoint: PreparedEventEndpoint): string {
  return endpoint.kind === 'existing' ? `id:${endpoint.id}` : `ref:${endpoint.ref}`;
}

function newNormalizedValues(values: readonly string[], existing: Set<string>): string[] {
  const seen = new Set(existing);
  return values.filter((value) => {
    const normalized = normalize(value);
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function exactRefMap<T extends { ref: string }>(
  expectedRefs: readonly string[],
  values: readonly T[],
  code: 'AI_PLAN_DECISIONS_INVALID' | 'AI_PLAN_INPUT_INVALID',
): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    if (result.has(value.ref)) throw new AiCaptureDataError(code, [value.ref]);
    result.set(value.ref, value);
  }
  const expected = new Set(expectedRefs);
  const affected = [
    ...expectedRefs.filter((ref) => !result.has(ref)),
    ...values.map((value) => value.ref).filter((ref) => !expected.has(ref)),
  ];
  if (affected.length > 0) {
    throw new AiCaptureDataError(code, [...new Set(affected)]);
  }
  return result;
}

function exactLinkMap<T extends { relationRef: string; caseRef: string }>(
  expected: readonly { relationRef: string; caseRef: string }[],
  values: readonly T[],
  code: 'AI_PLAN_DECISIONS_INVALID' | 'AI_PLAN_INPUT_INVALID',
): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const key = linkKey(value.relationRef, value.caseRef);
    if (result.has(key)) {
      throw new AiCaptureDataError(code, [value.relationRef, value.caseRef]);
    }
    result.set(key, value);
  }
  const expectedKeys = new Set(expected.map((value) => linkKey(value.relationRef, value.caseRef)));
  const affected = [
    ...expected
      .filter((value) => !result.has(linkKey(value.relationRef, value.caseRef)))
      .flatMap((value) => [value.relationRef, value.caseRef]),
    ...values
      .filter((value) => !expectedKeys.has(linkKey(value.relationRef, value.caseRef)))
      .flatMap((value) => [value.relationRef, value.caseRef]),
  ];
  if (affected.length > 0) {
    throw new AiCaptureDataError(code, [...new Set(affected)]);
  }
  return result;
}

function sorted<T>(values: T[], key: (value: T) => string): T[] {
  return values.toSorted((left, right) => key(left).localeCompare(key(right)));
}

function assertUnique(values: readonly string[], affectedRefs: readonly string[]): void {
  if (new Set(values).size !== values.length) {
    throw new AiCaptureDataError('AI_PLAN_UNIQUE_CONFLICT', [...affectedRefs]);
  }
}

function reuseMatch<T extends { id: string; updatedAt: string }>(
  ref: string,
  existingId: string,
  matches: readonly T[],
  state: T | undefined,
): T {
  const snapshot = matches.find((match) => match.id === existingId);
  if (!snapshot || !state) {
    throw new AiCaptureDataError('AI_PLAN_REUSE_INVALID', [ref]);
  }
  if (snapshot.updatedAt !== state.updatedAt) {
    throw new AiCaptureDataError('AI_PLAN_COMPARISON_STALE', [ref]);
  }
  return state;
}

export function parseAiImportPlanInput(input: unknown): PrepareAiImportPlanInput {
  const parsed = prepareAiImportPlanInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AiCaptureDataError('AI_PLAN_INPUT_INVALID');
  }
  return parsed.data;
}

export function prepareAiImportMutations(
  rawInput: unknown,
  state: AiImportPlanPreparationState,
): PreparedMutationSet {
  const input = parseAiImportPlanInput(rawInput);
  const eventRefs = input.candidates.atomicEvents.map((event) => event.ref);
  const caseRefs = input.candidates.concreteCases.map((concreteCase) => concreteCase.ref);
  const relationRefs = input.candidates.causalRelations.map((relation) => relation.ref);
  const linkRefs = input.candidates.relationCaseLinks;

  const eventDecisions = exactRefMap(
    eventRefs,
    input.decisions.atomicEvents,
    'AI_PLAN_DECISIONS_INVALID',
  );
  const caseDecisions = exactRefMap(
    caseRefs,
    input.decisions.concreteCases,
    'AI_PLAN_DECISIONS_INVALID',
  );
  const relationDecisions = exactRefMap(
    relationRefs,
    input.decisions.causalRelations,
    'AI_PLAN_DECISIONS_INVALID',
  );
  const linkDecisions = exactLinkMap(
    linkRefs,
    input.decisions.relationCaseLinks,
    'AI_PLAN_DECISIONS_INVALID',
  );
  const eventComparisons = exactRefMap(
    eventRefs,
    input.comparison.atomicEvents,
    'AI_PLAN_INPUT_INVALID',
  );
  const caseComparisons = exactRefMap(
    caseRefs,
    input.comparison.concreteCases,
    'AI_PLAN_INPUT_INVALID',
  );
  const relationComparisons = exactRefMap(
    relationRefs,
    input.comparison.causalRelations,
    'AI_PLAN_INPUT_INVALID',
  );
  const linkComparisons = exactLinkMap(
    linkRefs,
    input.comparison.relationCaseLinks,
    'AI_PLAN_INPUT_INVALID',
  );

  const eventsById = new Map(state.events.map((event) => [event.id, event]));
  const casesById = new Map(state.cases.map((concreteCase) => [concreteCase.id, concreteCase]));
  const relationsById = new Map(state.relations.map((relation) => [relation.id, relation]));
  const linksByKey = new Map(
    state.links.map((link) => [`${link.relationId}\u0000${link.caseId}`, link]),
  );

  const createEvents: PreparedEventCreate[] = [];
  const updateEvents: PreparedEventUpdate[] = [];
  const reuseEvents: PreparedEventReuse[] = [];
  const createCases: PreparedCaseCreate[] = [];
  const reuseCases: PreparedCaseReuse[] = [];
  const createRelations: PreparedRelationCreate[] = [];
  const reuseRelations: PreparedRelationReuse[] = [];
  const createLinks: PreparedLinkCreate[] = [];
  const confidenceChanges: PreparedConfidenceChange[] = [];
  const skipped: PreparedSkippedItem[] = [];
  const dependencies: PreparedDependencyVersion[] = [];
  const eventEndpoints = new Map<string, PreparedEventEndpoint>();
  const relationIdsByRef = new Map<string, string>();
  const caseIdsByRef = new Map<string, string>();
  const relationTargetsByRef = new Map<string, string>();
  const caseTargetsByRef = new Map<string, string>();
  const createdLinkTargets = new Set<string>();

  for (const candidate of input.candidates.atomicEvents) {
    const decision = eventDecisions.get(candidate.ref)!;
    if (decision.action === 'create') {
      if (
        eventComparisons
          .get(candidate.ref)!
          .matches.some(
            (match) =>
              match.matchKind === 'exact_name' &&
              normalize(match.name) === normalize(candidate.name),
          )
      ) {
        throw new AiCaptureDataError('AI_PLAN_UNIQUE_CONFLICT', [candidate.ref]);
      }
      createEvents.push({
        ...candidate,
        aliases: newNormalizedValues(candidate.aliases, new Set()),
        keywords: newNormalizedValues(candidate.keywords, new Set()),
      });
      eventEndpoints.set(candidate.ref, { kind: 'create', ref: candidate.ref });
      continue;
    }
    if (decision.action === 'skip') {
      skipped.push({ type: 'event', ref: candidate.ref, reason: decision.reason });
      continue;
    }
    const existing = reuseMatch(
      candidate.ref,
      decision.existingId,
      eventComparisons.get(candidate.ref)!.matches,
      eventsById.get(decision.existingId),
    );
    const comparisonMatch = eventComparisons
      .get(candidate.ref)!
      .matches.find((match) => match.id === existing.id)!;
    if (
      comparisonMatch.name !== existing.name ||
      comparisonMatch.description !== existing.description ||
      comparisonMatch.aliases.toSorted().join('\u0000') !==
        existing.aliases.toSorted().join('\u0000') ||
      comparisonMatch.keywords.toSorted().join('\u0000') !==
        existing.keywords.toSorted().join('\u0000')
    ) {
      throw new AiCaptureDataError('AI_PLAN_COMPARISON_STALE', [candidate.ref]);
    }
    reuseEvents.push({ ref: candidate.ref, id: existing.id });
    eventEndpoints.set(candidate.ref, { kind: 'existing', id: existing.id });
    const existingAliases = new Set(existing.aliases.map(normalize));
    const existingKeywords = new Set(existing.keywords.map(normalize));
    const appendAliases = newNormalizedValues(decision.appendAliases, existingAliases);
    const appendKeywords = newNormalizedValues(decision.appendKeywords, existingKeywords);
    const newDescription =
      decision.replaceDescription === undefined
        ? existing.description
        : decision.replaceDescription;
    if (
      appendAliases.length > 0 ||
      appendKeywords.length > 0 ||
      newDescription !== existing.description
    ) {
      updateEvents.push({
        ref: candidate.ref,
        id: existing.id,
        appendAliases,
        appendKeywords,
        oldDescription: existing.description,
        newDescription,
      });
    }
    dependencies.push({
      type: 'event',
      id: existing.id,
      relatedId: null,
      fingerprint: fingerprintDependency({
        ...existing,
        aliases: existing.aliases.toSorted(),
        keywords: existing.keywords.toSorted(),
      }),
    });
  }

  assertUnique(
    createEvents.map((event) => normalize(event.name)),
    createEvents.map((event) => event.ref),
  );

  for (const candidate of input.candidates.concreteCases) {
    const decision = caseDecisions.get(candidate.ref)!;
    if (decision.action === 'create') {
      if (
        caseComparisons
          .get(candidate.ref)!
          .matches.some(
            (match) => match.matchKind === 'exact_content' && match.content === candidate.content,
          )
      ) {
        throw new AiCaptureDataError('AI_PLAN_UNIQUE_CONFLICT', [candidate.ref]);
      }
      createCases.push({ ...candidate });
      caseTargetsByRef.set(candidate.ref, `ref:${candidate.ref}`);
      continue;
    }
    if (decision.action === 'skip') {
      skipped.push({ type: 'case', ref: candidate.ref, reason: decision.reason });
      continue;
    }
    const existing = reuseMatch(
      candidate.ref,
      decision.existingId,
      caseComparisons.get(candidate.ref)!.matches,
      casesById.get(decision.existingId),
    );
    const comparisonMatch = caseComparisons
      .get(candidate.ref)!
      .matches.find((match) => match.id === existing.id)!;
    if (comparisonMatch.content !== existing.content) {
      throw new AiCaptureDataError('AI_PLAN_COMPARISON_STALE', [candidate.ref]);
    }
    reuseCases.push({ ref: candidate.ref, id: existing.id });
    caseIdsByRef.set(candidate.ref, existing.id);
    caseTargetsByRef.set(candidate.ref, `id:${existing.id}`);
    dependencies.push({
      type: 'case',
      id: existing.id,
      relatedId: null,
      fingerprint: fingerprintDependency(existing),
    });
  }

  assertUnique(
    createCases.map((concreteCase) => concreteCase.content),
    createCases.map((concreteCase) => concreteCase.ref),
  );

  for (const candidate of input.candidates.causalRelations) {
    const decision = relationDecisions.get(candidate.ref)!;
    if (decision.action === 'skip') {
      skipped.push({ type: 'relation', ref: candidate.ref, reason: decision.reason });
      continue;
    }
    const causeEvent = eventEndpoints.get(candidate.causeEventRef);
    const effectEvent = eventEndpoints.get(candidate.effectEventRef);
    if (!causeEvent || !effectEvent) {
      const skippedRef = !causeEvent ? candidate.causeEventRef : candidate.effectEventRef;
      throw new AiCaptureDataError('AI_PLAN_DEPENDENCY_SKIPPED', [candidate.ref, skippedRef]);
    }
    const comparison = relationComparisons.get(candidate.ref)!;
    if (decision.action === 'create') {
      if (comparison.status === 'existing') {
        throw new AiCaptureDataError('AI_PLAN_UNIQUE_CONFLICT', [candidate.ref]);
      }
      if (eventEndpointKey(causeEvent) === eventEndpointKey(effectEvent)) {
        throw new AiCaptureDataError('AI_PLAN_UNIQUE_CONFLICT', [candidate.ref]);
      }
      createRelations.push({
        ref: candidate.ref,
        causeEvent,
        effectEvent,
        description: candidate.description,
      });
      relationTargetsByRef.set(candidate.ref, `ref:${candidate.ref}`);
      continue;
    }
    if (comparison.status !== 'existing' || comparison.relation.id !== decision.existingId) {
      throw new AiCaptureDataError('AI_PLAN_REUSE_INVALID', [candidate.ref]);
    }
    const existing = relationsById.get(decision.existingId);
    if (!existing) {
      throw new AiCaptureDataError('AI_PLAN_REUSE_INVALID', [candidate.ref]);
    }
    if (
      existing.updatedAt !== comparison.relation.updatedAt ||
      existing.causeEventId !== comparison.relation.causeEventId ||
      existing.effectEventId !== comparison.relation.effectEventId ||
      existing.description !== comparison.relation.description ||
      existing.confidence !== comparison.relation.confidence ||
      existing.caseIds.length !== comparison.relation.caseCount
    ) {
      throw new AiCaptureDataError('AI_PLAN_COMPARISON_STALE', [candidate.ref]);
    }
    const expectedCauseId = causeEvent.kind === 'existing' ? causeEvent.id : null;
    const expectedEffectId = effectEvent.kind === 'existing' ? effectEvent.id : null;
    if (expectedCauseId !== existing.causeEventId || expectedEffectId !== existing.effectEventId) {
      throw new AiCaptureDataError('AI_PLAN_REUSE_INVALID', [candidate.ref]);
    }
    reuseRelations.push({ ref: candidate.ref, id: existing.id });
    relationIdsByRef.set(candidate.ref, existing.id);
    relationTargetsByRef.set(candidate.ref, `id:${existing.id}`);
    dependencies.push({
      type: 'relation',
      id: existing.id,
      relatedId: null,
      fingerprint: fingerprintDependency({
        ...existing,
        caseIds: existing.caseIds.toSorted(),
      }),
    });
  }

  assertUnique(
    createRelations.map((relation) => relationPairKey(relation.causeEvent, relation.effectEvent)),
    createRelations.map((relation) => relation.ref),
  );

  for (const candidate of input.candidates.relationCaseLinks) {
    const key = linkKey(candidate.relationRef, candidate.caseRef);
    const decision = linkDecisions.get(key)!;
    const relationDecision = relationDecisions.get(candidate.relationRef)!;
    const caseDecision = caseDecisions.get(candidate.caseRef)!;
    if (relationDecision.action === 'skip' || caseDecision.action === 'skip') {
      if (decision.action !== 'skip') {
        const skippedRef =
          relationDecision.action === 'skip' ? candidate.relationRef : candidate.caseRef;
        throw new AiCaptureDataError('AI_PLAN_DEPENDENCY_SKIPPED', [
          candidate.relationRef,
          candidate.caseRef,
          skippedRef,
        ]);
      }
    }
    if (decision.action === 'skip') {
      skipped.push({
        type: 'link',
        ref: `${candidate.relationRef}:${candidate.caseRef}`,
        reason: decision.reason,
      });
      continue;
    }
    const comparison = linkComparisons.get(key)!;
    if (decision.action === 'reuse' && !comparison.exists) {
      throw new AiCaptureDataError('AI_PLAN_REUSE_INVALID', [
        candidate.relationRef,
        candidate.caseRef,
      ]);
    }
    if (decision.action === 'create' && comparison.exists) {
      throw new AiCaptureDataError('AI_PLAN_UNIQUE_CONFLICT', [
        candidate.relationRef,
        candidate.caseRef,
      ]);
    }
    const relationId = relationIdsByRef.get(candidate.relationRef);
    const concreteCaseId = caseIdsByRef.get(candidate.caseRef);
    if (relationId && concreteCaseId) {
      const link = linksByKey.get(`${relationId}\u0000${concreteCaseId}`);
      if (!link || link.exists !== comparison.exists) {
        throw new AiCaptureDataError('AI_PLAN_COMPARISON_STALE', [
          candidate.relationRef,
          candidate.caseRef,
        ]);
      }
      dependencies.push({
        type: 'link',
        id: relationId,
        relatedId: concreteCaseId,
        fingerprint: fingerprintDependency(link),
      });
    }
    if (decision.action === 'create') {
      const relationTarget = relationTargetsByRef.get(candidate.relationRef);
      const caseTarget = caseTargetsByRef.get(candidate.caseRef);
      const targetKey = `${relationTarget}\u0000${caseTarget}`;
      if (!relationTarget || !caseTarget || createdLinkTargets.has(targetKey)) {
        throw new AiCaptureDataError('AI_PLAN_UNIQUE_CONFLICT', [
          candidate.relationRef,
          candidate.caseRef,
        ]);
      }
      createdLinkTargets.add(targetKey);
      createLinks.push({ ...candidate });
    }
  }

  const createdLinksByRelation = new Map<string, number>();
  for (const link of createLinks) {
    createdLinksByRelation.set(
      link.relationRef,
      (createdLinksByRelation.get(link.relationRef) ?? 0) + 1,
    );
  }
  for (const relation of createRelations) {
    const newCaseCount = createdLinksByRelation.get(relation.ref) ?? 0;
    const newConfidence = calculateAutomaticConfidence({
      baselineConfidence: 10,
      baselineCaseCount: 0,
      currentCaseCount: newCaseCount,
    });
    if (newConfidence !== 10) {
      confidenceChanges.push({
        relationRef: relation.ref,
        relationId: null,
        oldConfidence: 10,
        newConfidence,
        oldCaseCount: 0,
        newCaseCount,
      });
    }
  }
  for (const relation of reuseRelations) {
    const existing = relationsById.get(relation.id)!;
    const addedCases = createdLinksByRelation.get(relation.ref) ?? 0;
    if (addedCases === 0) continue;
    const oldCaseCount = existing.caseIds.length;
    const newCaseCount = oldCaseCount + addedCases;
    const newConfidence = calculateAutomaticConfidence({
      baselineConfidence: existing.baselineConfidence,
      baselineCaseCount: existing.baselineCaseCount,
      currentCaseCount: newCaseCount,
    });
    if (newConfidence !== existing.confidence) {
      confidenceChanges.push({
        relationRef: relation.ref,
        relationId: relation.id,
        oldConfidence: existing.confidence,
        newConfidence,
        oldCaseCount,
        newCaseCount,
      });
    }
  }

  const summary: AiImportChangeCounts = {
    eventCreated: createEvents.length,
    eventReused: reuseEvents.length,
    eventUpdated: updateEvents.length,
    caseCreated: createCases.length,
    caseReused: reuseCases.length,
    relationCreated: createRelations.length,
    relationReused: reuseRelations.length,
    relationCaseCreated: createLinks.length,
    confidenceChanged: confidenceChanges.length,
  };
  const uniqueDependencies = [
    ...new Map(
      dependencies.map((dependency) => [
        `${dependency.type}\u0000${dependency.id}\u0000${dependency.relatedId ?? ''}`,
        dependency,
      ]),
    ).values(),
  ];

  return {
    createEvents: sorted(createEvents, (item) => item.ref),
    updateEvents: sorted(updateEvents, (item) => item.ref),
    reuseEvents: sorted(reuseEvents, (item) => item.ref),
    createCases: sorted(createCases, (item) => item.ref),
    reuseCases: sorted(reuseCases, (item) => item.ref),
    createRelations: sorted(createRelations, (item) => item.ref),
    reuseRelations: sorted(reuseRelations, (item) => item.ref),
    createLinks: sorted(createLinks, (item) => linkKey(item.relationRef, item.caseRef)),
    confidenceChanges: sorted(confidenceChanges, (item) => item.relationRef),
    skipped: sorted(skipped, (item) => `${item.type}\u0000${item.ref}`),
    dependencies: sorted(
      uniqueDependencies,
      (item) => `${item.type}\u0000${item.id}\u0000${item.relatedId ?? ''}`,
    ),
    summary,
  };
}
