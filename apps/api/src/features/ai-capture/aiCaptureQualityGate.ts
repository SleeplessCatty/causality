import {
  type AiCaptureCandidateSet,
  type AiCaptureComparison,
  type AiCaptureQualityEntityType,
  type AiCaptureQualityIssue,
  type AiCaptureQualityIssueCode,
  type AiCaptureQualityReport,
  type AiCaptureQualitySeverity,
  type AiCaptureTopicRelevanceSignal,
  type PrepareAiImportPlanInput,
} from '@causality/contracts';
import type { z } from 'zod';

import {
  aiImportPlanLinkKey,
  buildAiImportPlanLocationIndex,
  decisionPathsForPlanIssue,
  type AiImportPlanLocationIndex,
} from './aiImportPlanLocationIndex.js';

const severityRank = { error: 0, warning: 1 } as const;
const SEMANTIC_DUPLICATE_THRESHOLD = 0.9;
const compoundConnectorPattern = /并且|同时|以及|并/;
const compoundSplitPattern = /并且|同时|以及|并/;
const changePhrasePattern =
  /增加|上升|下降|减少|扩大|缩小|改善|恶化|中断|恢复|停运|停止|延迟|加快|放缓|增长|降低|提高|暴跌|暴增|短缺|过剩|上涨|下跌|裁员|退出|进入|关闭|开工|复工|扩产|减产|收缩|攀升|回落|变动|变化|提升/;
const qualityCodes = new Set<AiCaptureQualityIssueCode>([
  'AI_QUALITY_SCHEMA_INVALID',
  'AI_QUALITY_EVENT_LIMIT_EXCEEDED',
  'AI_QUALITY_DUPLICATE_REF',
  'AI_QUALITY_REFERENCE_MISSING',
  'AI_QUALITY_SELF_LOOP',
  'AI_QUALITY_DUPLICATE_LINK',
  'AI_QUALITY_DUPLICATE_EVENT_NAME',
  'AI_QUALITY_DUPLICATE_CASE_CONTENT',
  'AI_QUALITY_DUPLICATE_RELATION',
  'AI_QUALITY_ORPHAN_EVENT',
  'AI_QUALITY_ORPHAN_CASE',
  'AI_QUALITY_COMPOUND_EVENT_SUSPECTED',
  'AI_QUALITY_ALIAS_COLLISION',
  'AI_QUALITY_RELATION_WITHOUT_CASE',
  'AI_QUALITY_TRANSITIVE_SHORTCUT_SUSPECTED',
  'AI_QUALITY_EVENTS_SHARE_EXACT_MATCH',
  'AI_QUALITY_CASES_SHARE_EXACT_MATCH',
  'AI_QUALITY_EVENT_SEMANTIC_DUPLICATE_SUSPECTED',
  'AI_QUALITY_CASE_SEMANTIC_DUPLICATE_SUSPECTED',
  'AI_QUALITY_ACTIVE_EVENT_ORPHANED',
  'AI_QUALITY_ACTIVE_CASE_ORPHANED',
  'AI_QUALITY_DECISION_DEPENDENCY_INVALID',
  'AI_QUALITY_COMPARISON_COVERAGE_INVALID',
  'AI_QUALITY_DECISION_COVERAGE_INVALID',
  'AI_QUALITY_REUSE_TARGET_INVALID',
  'AI_QUALITY_CREATE_EXACT_CONFLICT',
  'AI_QUALITY_COMPARISON_STALE',
  'AI_QUALITY_BATCH_UNIQUE_CONFLICT',
  'AI_QUALITY_REPORT_BLOCKED',
]);

interface IssueDetails {
  code: AiCaptureQualityIssueCode;
  severity: AiCaptureQualitySeverity;
  entityType: AiCaptureQualityEntityType;
  refs: string[];
  path: string;
  message: string;
}

interface ComparisonCandidate {
  ref: string;
  matches: readonly {
    id: string;
    matchKind: AiCaptureComparison['atomicEvents'][number]['matches'][number]['matchKind'];
    similarity: number | null;
  }[];
}

interface SharedMatchIssueOptions {
  groups: ReadonlyMap<string, Array<{ ref: string; index: number }>>;
  section: 'atomicEvents' | 'concreteCases';
  code: AiCaptureQualityIssueCode;
  entityType: Extract<AiCaptureQualityEntityType, 'event' | 'case'>;
  message: string;
  matchPathSuffix: '/matches' | '/matches/0';
}

interface ComparisonEntityMatchGroups {
  exact: Map<string, Array<{ ref: string; index: number }>>;
  semantic: Map<string, Array<{ ref: string; index: number }>>;
}

interface ComparisonMatchGroups {
  events: ComparisonEntityMatchGroups;
  cases: ComparisonEntityMatchGroups;
}

interface IndexedCandidate<T> {
  value: T;
  index: number;
}

interface CandidateQualityIndex {
  events: Array<IndexedCandidate<AiCaptureCandidateSet['atomicEvents'][number]>>;
  cases: Array<IndexedCandidate<AiCaptureCandidateSet['concreteCases'][number]>>;
  relations: Array<IndexedCandidate<AiCaptureCandidateSet['causalRelations'][number]>>;
  eventNames: Map<string, IndexedCandidate<AiCaptureCandidateSet['atomicEvents'][number]>[]>;
  caseContents: Map<string, IndexedCandidate<AiCaptureCandidateSet['concreteCases'][number]>[]>;
  relationEndpoints: Map<
    string,
    IndexedCandidate<AiCaptureCandidateSet['causalRelations'][number]>[]
  >;
  connectedEventRefs: Set<string>;
  linkedCaseRefs: Set<string>;
  linkedRelationRefs: Set<string>;
  outgoingByCause: Map<string, Set<string>>;
  incomingByEffect: Map<string, Set<string>>;
}

function appendIndex<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

function addAdjacency(map: Map<string, Set<string>>, from: string, to: string): void {
  const adjacent = map.get(from) ?? new Set<string>();
  adjacent.add(to);
  map.set(from, adjacent);
}

function buildCandidateQualityIndex(input: AiCaptureCandidateSet): CandidateQualityIndex {
  const index: CandidateQualityIndex = {
    events: [],
    cases: [],
    relations: [],
    eventNames: new Map(),
    caseContents: new Map(),
    relationEndpoints: new Map(),
    connectedEventRefs: new Set(),
    linkedCaseRefs: new Set(),
    linkedRelationRefs: new Set(),
    outgoingByCause: new Map(),
    incomingByEffect: new Map(),
  };

  input.atomicEvents.forEach((value, entryIndex) => {
    const entry = { value, index: entryIndex };
    index.events.push(entry);
    appendIndex(index.eventNames, normalizeEventName(value.name), entry);
  });
  input.concreteCases.forEach((value, entryIndex) => {
    const entry = { value, index: entryIndex };
    index.cases.push(entry);
    appendIndex(index.caseContents, value.content.trim(), entry);
  });
  input.causalRelations.forEach((value, entryIndex) => {
    const entry = { value, index: entryIndex };
    index.relations.push(entry);
    appendIndex(
      index.relationEndpoints,
      relationEndpointKey(value.causeEventRef, value.effectEventRef),
      entry,
    );
    index.connectedEventRefs.add(value.causeEventRef);
    index.connectedEventRefs.add(value.effectEventRef);
    addAdjacency(index.outgoingByCause, value.causeEventRef, value.effectEventRef);
    addAdjacency(index.incomingByEffect, value.effectEventRef, value.causeEventRef);
  });
  input.relationCaseLinks.forEach((value) => {
    index.linkedRelationRefs.add(value.relationRef);
    index.linkedCaseRefs.add(value.caseRef);
  });

  return index;
}

function issueOrder(left: AiCaptureQualityIssue, right: AiCaptureQualityIssue): number {
  return (
    severityRank[left.severity] - severityRank[right.severity] ||
    left.code.localeCompare(right.code) ||
    (left.paths[0] ?? '').localeCompare(right.paths[0] ?? '') ||
    (left.refs[0] ?? '').localeCompare(right.refs[0] ?? '')
  );
}

function candidateIssue(details: IssueDetails): AiCaptureQualityIssue {
  return {
    code: details.code,
    severity: details.severity,
    phase: 'candidate',
    entityType: details.entityType,
    refs: details.refs,
    paths: [details.path],
    message: details.message,
    suggestedAction: suggestionForCode(details.code),
    aiCanRepair: true,
  };
}

function comparisonIssue(
  details: Omit<IssueDetails, 'path'> & { paths: string[] },
): AiCaptureQualityIssue {
  return {
    code: details.code,
    severity: details.severity,
    phase: 'comparison',
    entityType: details.entityType,
    refs: details.refs,
    paths: details.paths,
    message: details.message,
    suggestedAction: suggestionForCode(details.code),
    aiCanRepair: true,
  };
}

function planIssue(
  details: Omit<IssueDetails, 'path'> & { paths: string[] },
): AiCaptureQualityIssue {
  return {
    code: details.code,
    severity: details.severity,
    phase: 'plan',
    entityType: details.entityType,
    refs: details.refs,
    paths: details.paths.length > 0 ? details.paths : ['/decisions'],
    message: details.message,
    suggestedAction: suggestionForCode(details.code),
    aiCanRepair: true,
  };
}

export function buildQualityReport(
  issues: readonly AiCaptureQualityIssue[],
  topicRelevance: readonly AiCaptureTopicRelevanceSignal[] = [],
): AiCaptureQualityReport {
  const sorted = [...issues].sort(issueOrder);
  return {
    version: 1,
    status: sorted.some((issue) => issue.severity === 'error')
      ? 'blocked'
      : sorted.length > 0
        ? 'warning'
        : 'passed',
    issues: sorted,
    topicRelevance: [...topicRelevance].sort((left, right) => left.ref.localeCompare(right.ref)),
  };
}

export function mergeQualityReports(
  ...reports: readonly AiCaptureQualityReport[]
): AiCaptureQualityReport {
  return buildQualityReport(
    reports.flatMap((report) => report.issues),
    reports.flatMap((report) => report.topicRelevance),
  );
}

export class AiCaptureQualityGate {
  public inspectCandidates(input: AiCaptureCandidateSet): AiCaptureQualityReport {
    const index = buildCandidateQualityIndex(input);
    return buildQualityReport([
      ...duplicateEventNameIssues(index),
      ...duplicateCaseContentIssues(index),
      ...duplicateRelationIssues(index),
      ...orphanEventIssues(index),
      ...orphanCaseIssues(index),
      ...candidateWarningIssues(index),
    ]);
  }

  public inspectComparison(input: {
    candidates: AiCaptureCandidateSet;
    comparison: AiCaptureComparison;
    topicRelevance: AiCaptureTopicRelevanceSignal[];
  }): AiCaptureQualityReport {
    return buildQualityReport(
      [
        ...this.inspectCandidates(input.candidates).issues,
        ...sharedComparisonMatchIssues(input.comparison),
      ],
      input.topicRelevance,
    );
  }

  public inspectPlan(input: PrepareAiImportPlanInput): AiCaptureQualityReport {
    const locationIndex = buildAiImportPlanLocationIndex(input);
    const candidateReport = this.inspectCandidates(input.candidates);
    const comparisonReport = buildQualityReport(sharedComparisonMatchIssues(input.comparison));
    const candidateIssues = candidateReport.issues
      .filter((issue) => issue.code !== 'AI_QUALITY_RELATION_WITHOUT_CASE')
      .map((issue) => issueForPlan(locationIndex, issue));
    const comparisonWarnings = comparisonReport.issues.map((issue) =>
      issueForPlan(locationIndex, issue),
    );
    const blockedCandidateIssues = candidateReport.issues.filter(
      (issue) => issue.severity === 'error',
    );

    return buildQualityReport([
      ...candidateIssues,
      ...comparisonWarnings,
      ...(blockedCandidateIssues.length > 0
        ? [
            planIssue({
              code: 'AI_QUALITY_REPORT_BLOCKED',
              severity: 'error',
              entityType: 'batch',
              refs: [...new Set(blockedCandidateIssues.flatMap((issue) => issue.refs))],
              paths: ['/decisions'],
              message: '候选集合重新检查后仍存在阻断问题',
            }),
          ]
        : []),
      ...planDecisionIssues(input, locationIndex),
    ]);
  }
}

function issueForPlan(
  locationIndex: AiImportPlanLocationIndex,
  issue: AiCaptureQualityIssue,
): AiCaptureQualityIssue {
  return planIssue({
    code: issue.code,
    severity: issue.severity,
    entityType: issue.entityType,
    refs: issue.refs,
    paths: decisionPathsForPlanIssue(locationIndex, issue.entityType, issue.refs),
    message: issue.message,
  });
}

function planDecisionIssues(
  input: PrepareAiImportPlanInput,
  locationIndex: AiImportPlanLocationIndex,
): AiCaptureQualityIssue[] {
  const eventDecisions = locationIndex.decisions.atomicEvents.byRef;
  const caseDecisions = locationIndex.decisions.concreteCases.byRef;
  const relationDecisions = locationIndex.decisions.causalRelations.byRef;
  const linkDecisions = locationIndex.decisions.relationCaseLinks.byKey;
  const activeRelationRefs = new Set(
    input.decisions.causalRelations.flatMap((decision) =>
      decision.action === 'skip' ? [] : [decision.ref],
    ),
  );
  const activeLinkKeys = new Set(
    input.decisions.relationCaseLinks.flatMap((decision) =>
      decision.action === 'skip'
        ? []
        : [aiImportPlanLinkKey(decision.relationRef, decision.caseRef)],
    ),
  );
  const connectedEventRefs = new Set(
    input.candidates.causalRelations.flatMap((relation) =>
      activeRelationRefs.has(relation.ref) ? [relation.causeEventRef, relation.effectEventRef] : [],
    ),
  );
  const linkedCaseRefs = new Set(
    input.candidates.relationCaseLinks.flatMap((link) =>
      activeLinkKeys.has(aiImportPlanLinkKey(link.relationRef, link.caseRef)) ? [link.caseRef] : [],
    ),
  );
  const linkedRelationRefs = new Set(
    input.candidates.relationCaseLinks.flatMap((link) =>
      activeLinkKeys.has(aiImportPlanLinkKey(link.relationRef, link.caseRef))
        ? [link.relationRef]
        : [],
    ),
  );
  const issues: AiCaptureQualityIssue[] = [];

  input.decisions.atomicEvents.forEach((decision, index) => {
    if (decision.action !== 'skip' && !connectedEventRefs.has(decision.ref)) {
      issues.push(
        planIssue({
          code: 'AI_QUALITY_ACTIVE_EVENT_ORPHANED',
          severity: 'error',
          entityType: 'event',
          refs: [decision.ref],
          paths: [`/decisions/atomicEvents/${index}`],
          message: '有效原子事件尚未进入有效因果关系决策',
        }),
      );
    }
  });

  input.decisions.concreteCases.forEach((decision, index) => {
    if (decision.action !== 'skip' && !linkedCaseRefs.has(decision.ref)) {
      issues.push(
        planIssue({
          code: 'AI_QUALITY_ACTIVE_CASE_ORPHANED',
          severity: 'error',
          entityType: 'case',
          refs: [decision.ref],
          paths: [`/decisions/concreteCases/${index}`],
          message: '有效具体案例尚未进入有效案例关联决策',
        }),
      );
    }
  });

  input.decisions.causalRelations.forEach((decision, index) => {
    if (decision.action !== 'skip' && !linkedRelationRefs.has(decision.ref)) {
      issues.push(
        planIssue({
          code: 'AI_QUALITY_RELATION_WITHOUT_CASE',
          severity: 'warning',
          entityType: 'relation',
          refs: [decision.ref],
          paths: [`/decisions/causalRelations/${index}`],
          message: '有效因果关系尚未关联具体案例',
        }),
      );
    }
  });

  input.candidates.causalRelations.forEach((relation) => {
    const relationEntry = relationDecisions.get(relation.ref)?.at(-1);
    if (!relationEntry || relationEntry.value.action === 'skip') return;
    const skippedEventRefs = [relation.causeEventRef, relation.effectEventRef].filter(
      (ref) => eventDecisions.get(ref)?.at(-1)?.value.action === 'skip',
    );
    if (skippedEventRefs.length === 0) return;
    issues.push(
      planIssue({
        code: 'AI_QUALITY_DECISION_DEPENDENCY_INVALID',
        severity: 'error',
        entityType: 'relation',
        refs: [relation.ref, ...skippedEventRefs],
        paths: [
          relationEntry.path,
          ...skippedEventRefs.flatMap((ref) => {
            const entry = eventDecisions.get(ref)?.at(-1);
            return entry ? [entry.path] : [];
          }),
        ],
        message: '有效因果关系依赖已跳过的原子事件决策',
      }),
    );
  });

  input.candidates.relationCaseLinks.forEach((link) => {
    const key = aiImportPlanLinkKey(link.relationRef, link.caseRef);
    const linkEntry = linkDecisions.get(key)?.at(-1);
    if (!linkEntry || linkEntry.value.action === 'skip') return;
    const relationEntry = relationDecisions.get(link.relationRef)?.at(-1);
    const caseEntry = caseDecisions.get(link.caseRef)?.at(-1);
    const relationSkipped = relationEntry?.value.action === 'skip';
    const caseSkipped = caseEntry?.value.action === 'skip';
    if (!relationSkipped && !caseSkipped) return;
    issues.push(
      planIssue({
        code: 'AI_QUALITY_DECISION_DEPENDENCY_INVALID',
        severity: 'error',
        entityType: 'link',
        refs: [link.relationRef, link.caseRef],
        paths: [
          linkEntry.path,
          ...(relationSkipped && relationEntry ? [relationEntry.path] : []),
          ...(caseSkipped && caseEntry ? [caseEntry.path] : []),
        ],
        message: '有效案例关联依赖已跳过的因果关系或具体案例决策',
      }),
    );
  });

  return issues;
}

function newComparisonEntityMatchGroups(): ComparisonEntityMatchGroups {
  return { exact: new Map(), semantic: new Map() };
}

function indexComparisonMatches(
  candidates: readonly ComparisonCandidate[],
): ComparisonEntityMatchGroups {
  const groups = newComparisonEntityMatchGroups();
  candidates.forEach((candidate, index) => {
    const entry = { ref: candidate.ref, index };
    const exactId = uniqueExactMatchId(candidate.matches);
    if (exactId) appendIndex(groups.exact, exactId, entry);
    const semanticId = qualifyingSemanticMatchId(candidate);
    if (semanticId) appendIndex(groups.semantic, semanticId, entry);
  });
  return groups;
}

function buildComparisonMatchGroups(comparison: AiCaptureComparison): ComparisonMatchGroups {
  return {
    events: indexComparisonMatches(comparison.atomicEvents),
    cases: indexComparisonMatches(comparison.concreteCases),
  };
}

function sharedComparisonMatchIssues(comparison: AiCaptureComparison): AiCaptureQualityIssue[] {
  const groups = buildComparisonMatchGroups(comparison);
  return [
    ...sharedMatchIssues({
      groups: groups.events.exact,
      section: 'atomicEvents',
      code: 'AI_QUALITY_EVENTS_SHARE_EXACT_MATCH',
      entityType: 'event',
      message: '多个原子事件候选唯一精确匹配同一已有原子事件',
      matchPathSuffix: '/matches',
    }),
    ...sharedMatchIssues({
      groups: groups.cases.exact,
      section: 'concreteCases',
      code: 'AI_QUALITY_CASES_SHARE_EXACT_MATCH',
      entityType: 'case',
      message: '多个具体案例候选唯一精确匹配同一已有具体案例',
      matchPathSuffix: '/matches',
    }),
    ...sharedMatchIssues({
      groups: groups.events.semantic,
      section: 'atomicEvents',
      code: 'AI_QUALITY_EVENT_SEMANTIC_DUPLICATE_SUSPECTED',
      entityType: 'event',
      message: '多个原子事件候选高相似指向同一已有原子事件',
      matchPathSuffix: '/matches/0',
    }),
    ...sharedMatchIssues({
      groups: groups.cases.semantic,
      section: 'concreteCases',
      code: 'AI_QUALITY_CASE_SEMANTIC_DUPLICATE_SUSPECTED',
      entityType: 'case',
      message: '多个具体案例候选高相似指向同一已有具体案例',
      matchPathSuffix: '/matches/0',
    }),
  ];
}

function sharedMatchIssues(options: SharedMatchIssueOptions): AiCaptureQualityIssue[] {
  return [...options.groups.values()].flatMap((matches) =>
    matches.length > 1
      ? [
          comparisonIssue({
            code: options.code,
            severity: 'warning',
            entityType: options.entityType,
            refs: matches.map((match) => match.ref),
            paths: matches.map(
              (match) => `/${options.section}/${match.index}${options.matchPathSuffix}`,
            ),
            message: options.message,
          }),
        ]
      : [],
  );
}

export function uniqueExactMatchId(
  matches: readonly ComparisonCandidate['matches'][number][],
): string | null {
  const exactIds = new Set(
    matches
      .filter(
        (match) =>
          match.matchKind === 'exact_name' ||
          match.matchKind === 'exact_alias' ||
          match.matchKind === 'exact_content',
      )
      .map((match) => match.id),
  );
  return exactIds.size === 1 ? [...exactIds][0]! : null;
}

function qualifyingSemanticMatchId(candidate: ComparisonCandidate): string | null {
  const firstMatch = candidate.matches[0];
  return firstMatch?.matchKind === 'semantic' &&
    firstMatch.similarity !== null &&
    firstMatch.similarity >= SEMANTIC_DUPLICATE_THRESHOLD
    ? firstMatch.id
    : null;
}

function duplicateEventNameIssues(index: CandidateQualityIndex): AiCaptureQualityIssue[] {
  return [...index.eventNames.values()].flatMap((entries) =>
    entries.slice(1).map(({ value: event, index: eventIndex }) =>
      candidateIssue({
        code: 'AI_QUALITY_DUPLICATE_EVENT_NAME',
        severity: 'error',
        entityType: 'event',
        refs: [event.ref],
        path: `/atomicEvents/${eventIndex}/name`,
        message: '候选原子事件名称重复',
      }),
    ),
  );
}

function duplicateCaseContentIssues(index: CandidateQualityIndex): AiCaptureQualityIssue[] {
  return [...index.caseContents.values()].flatMap((entries) =>
    entries.slice(1).map(({ value: concreteCase, index: caseIndex }) =>
      candidateIssue({
        code: 'AI_QUALITY_DUPLICATE_CASE_CONTENT',
        severity: 'error',
        entityType: 'case',
        refs: [concreteCase.ref],
        path: `/concreteCases/${caseIndex}/content`,
        message: '候选具体案例内容重复',
      }),
    ),
  );
}

function duplicateRelationIssues(index: CandidateQualityIndex): AiCaptureQualityIssue[] {
  return [...index.relationEndpoints.values()].flatMap((entries) =>
    entries.slice(1).map(({ value: relation, index: relationIndex }) =>
      candidateIssue({
        code: 'AI_QUALITY_DUPLICATE_RELATION',
        severity: 'error',
        entityType: 'relation',
        refs: [relation.ref],
        path: `/causalRelations/${relationIndex}`,
        message: '候选因果关系重复',
      }),
    ),
  );
}

function orphanEventIssues(index: CandidateQualityIndex): AiCaptureQualityIssue[] {
  return index.events.flatMap(({ value: event, index: eventIndex }) =>
    index.connectedEventRefs.has(event.ref)
      ? []
      : [
          candidateIssue({
            code: 'AI_QUALITY_ORPHAN_EVENT',
            severity: 'error',
            entityType: 'event',
            refs: [event.ref],
            path: `/atomicEvents/${eventIndex}`,
            message: '候选原子事件尚未关联因果关系',
          }),
        ],
  );
}

function orphanCaseIssues(index: CandidateQualityIndex): AiCaptureQualityIssue[] {
  return index.cases.flatMap(({ value: concreteCase, index: caseIndex }) =>
    index.linkedCaseRefs.has(concreteCase.ref)
      ? []
      : [
          candidateIssue({
            code: 'AI_QUALITY_ORPHAN_CASE',
            severity: 'error',
            entityType: 'case',
            refs: [concreteCase.ref],
            path: `/concreteCases/${caseIndex}`,
            message: '候选具体案例尚未关联因果关系',
          }),
        ],
  );
}

function candidateWarningIssues(index: CandidateQualityIndex): AiCaptureQualityIssue[] {
  return [
    ...compoundEventIssues(index),
    ...aliasCollisionIssues(index),
    ...relationWithoutCaseIssues(index),
    ...transitiveShortcutIssues(index),
  ];
}

function compoundEventIssues(index: CandidateQualityIndex): AiCaptureQualityIssue[] {
  return index.events.flatMap(({ value: event, index: eventIndex }) => {
    const field = isCompoundEvent(event.name)
      ? 'name'
      : event.description !== null && isCompoundEvent(event.description)
        ? 'description'
        : null;

    return field
      ? [
          candidateIssue({
            code: 'AI_QUALITY_COMPOUND_EVENT_SUSPECTED',
            severity: 'warning',
            entityType: 'event',
            refs: [event.ref],
            path: `/atomicEvents/${eventIndex}/${field}`,
            message: '候选原子事件可能包含多个独立变化',
          }),
        ]
      : [];
  });
}

function aliasCollisionIssues(index: CandidateQualityIndex): AiCaptureQualityIssue[] {
  const seen = new Map<string, { ref: string; isAlias: boolean }>();
  const issues: AiCaptureQualityIssue[] = [];

  index.events.forEach(({ value: event, index: eventIndex }) => {
    const values = [
      { value: event.name, path: `/atomicEvents/${eventIndex}/name`, isAlias: false },
      ...event.aliases.map((alias, aliasIndex) => ({
        value: alias,
        path: `/atomicEvents/${eventIndex}/aliases/${aliasIndex}`,
        isAlias: true,
      })),
    ];

    for (const entry of values) {
      const normalized = normalizeEventName(entry.value);
      const existing = seen.get(normalized);
      if (existing && existing.ref !== event.ref && (entry.isAlias || existing.isAlias)) {
        issues.push(
          candidateIssue({
            code: 'AI_QUALITY_ALIAS_COLLISION',
            severity: 'warning',
            entityType: 'event',
            refs: [event.ref, existing.ref],
            path: entry.path,
            message: '候选事件名称或别名与另一候选事件冲突',
          }),
        );
      }
      seen.set(normalized, { ref: event.ref, isAlias: entry.isAlias });
    }
  });

  return issues;
}

function relationWithoutCaseIssues(index: CandidateQualityIndex): AiCaptureQualityIssue[] {
  return index.relations.flatMap(({ value: relation, index: relationIndex }) =>
    index.linkedRelationRefs.has(relation.ref)
      ? []
      : [
          candidateIssue({
            code: 'AI_QUALITY_RELATION_WITHOUT_CASE',
            severity: 'warning',
            entityType: 'relation',
            refs: [relation.ref],
            path: `/causalRelations/${relationIndex}`,
            message: '候选因果关系尚未关联具体案例',
          }),
        ],
  );
}

function transitiveShortcutIssues(index: CandidateQualityIndex): AiCaptureQualityIssue[] {
  return index.relations.flatMap(({ value: relation, index: relationIndex }) => {
    const outgoing = index.outgoingByCause.get(relation.causeEventRef) ?? new Set<string>();
    const incoming = index.incomingByEffect.get(relation.effectEventRef) ?? new Set<string>();
    const [midpointCandidates, otherSide] =
      outgoing.size <= incoming.size ? [outgoing, incoming] : [incoming, outgoing];
    let hasShortcut = false;
    for (const midpoint of midpointCandidates) {
      if (otherSide.has(midpoint)) {
        hasShortcut = true;
        break;
      }
    }

    return hasShortcut
      ? [
          candidateIssue({
            code: 'AI_QUALITY_TRANSITIVE_SHORTCUT_SUSPECTED',
            severity: 'warning',
            entityType: 'relation',
            refs: [relation.ref],
            path: `/causalRelations/${relationIndex}`,
            message: '候选因果关系可能是传递路径的快捷边',
          }),
        ]
      : [];
  });
}

function isCompoundEvent(text: string): boolean {
  if (!compoundConnectorPattern.test(text)) return false;

  return (
    text.split(compoundSplitPattern).filter((part) => changePhrasePattern.test(part)).length >= 2
  );
}

function normalizeEventName(value: string): string {
  return value.trim().toLocaleLowerCase('zh-CN');
}

function relationEndpointKey(causeEventRef: string, effectEventRef: string): string {
  return `${causeEventRef}\u0000${effectEventRef}`;
}

export function qualityReportFromZodError(raw: unknown, error: z.ZodError): AiCaptureQualityReport {
  return buildQualityReport(
    error.issues.map((issue) => {
      const code = qualityCodeFromIssue(issue);
      return candidateIssue({
        code,
        severity: 'error',
        entityType: entityTypeFromIssue(issue),
        refs: refsFromPath(raw, issue.path),
        path: toJsonPointer(issue.path),
        message: issue.message,
      });
    }),
  );
}

function qualityCodeFromIssue(issue: z.core.$ZodIssue): AiCaptureQualityIssueCode {
  const params = (issue as { params?: { qualityCode?: unknown } }).params;
  if (isQualityCode(params?.qualityCode)) {
    return params.qualityCode;
  }

  return isAtomicEventsLimitIssue(issue)
    ? 'AI_QUALITY_EVENT_LIMIT_EXCEEDED'
    : 'AI_QUALITY_SCHEMA_INVALID';
}

function isAtomicEventsLimitIssue(issue: z.core.$ZodIssue): boolean {
  return (
    issue.code === 'too_big' &&
    issue.origin === 'array' &&
    issue.maximum === 50 &&
    issue.path.length === 1 &&
    issue.path[0] === 'atomicEvents'
  );
}

function isQualityCode(value: unknown): value is AiCaptureQualityIssueCode {
  return typeof value === 'string' && qualityCodes.has(value as AiCaptureQualityIssueCode);
}

function entityTypeFromIssue(issue: z.core.$ZodIssue): AiCaptureQualityEntityType {
  return isAtomicEventsLimitIssue(issue) ? 'batch' : entityTypeFromPath(issue.path);
}

function entityTypeFromPath(path: readonly PropertyKey[]): AiCaptureQualityEntityType {
  switch (path[0]) {
    case 'atomicEvents':
      return 'event';
    case 'concreteCases':
      return 'case';
    case 'causalRelations':
      return 'relation';
    case 'relationCaseLinks':
      return 'link';
    default:
      return 'batch';
  }
}

function refsFromPath(raw: unknown, path: readonly PropertyKey[]): string[] {
  const [section, index] = path;
  if (typeof section !== 'string' || typeof index !== 'number' || !isRecord(raw)) return [];

  const candidates = raw[section];
  if (!Array.isArray(candidates) || !isRecord(candidates[index])) return [];

  const candidate = candidates[index];
  if (section === 'relationCaseLinks') {
    return [candidate.relationRef, candidate.caseRef].filter(
      (ref): ref is string => typeof ref === 'string',
    );
  }

  return typeof candidate.ref === 'string' ? [candidate.ref] : [];
}

export function toJsonPointer(path: readonly PropertyKey[]): string {
  if (path.length === 0) return '/';

  return `/${path
    .map((part) => String(part).replaceAll('~', '~0').replaceAll('/', '~1'))
    .join('/')}`;
}

function suggestionForCode(code: AiCaptureQualityIssueCode): string {
  switch (code) {
    case 'AI_QUALITY_SCHEMA_INVALID':
      return '按字段路径修正参数';
    case 'AI_QUALITY_EVENT_LIMIT_EXCEEDED':
      return '保留主线数据并移除其余内容';
    case 'AI_QUALITY_DUPLICATE_REF':
      return '合并候选并保留一个稳定 ref';
    case 'AI_QUALITY_REFERENCE_MISSING':
      return '补齐引用或移除依赖项';
    case 'AI_QUALITY_SELF_LOOP':
      return '修正端点或移除关系';
    case 'AI_QUALITY_DUPLICATE_LINK':
      return '合并重复关联';
    case 'AI_QUALITY_DUPLICATE_EVENT_NAME':
      return '合并为一个事件候选';
    case 'AI_QUALITY_DUPLICATE_CASE_CONTENT':
      return '合并为一个案例候选';
    case 'AI_QUALITY_DUPLICATE_RELATION':
      return '合并为一条关系候选';
    case 'AI_QUALITY_ORPHAN_EVENT':
      return '移入忽略数据或补充有效关系';
    case 'AI_QUALITY_ORPHAN_CASE':
      return '移入忽略数据或补充有效关联';
    case 'AI_QUALITY_COMPOUND_EVENT_SUSPECTED':
      return '拆分为可独立验证的原子事件';
    case 'AI_QUALITY_ALIAS_COLLISION':
      return '确认是否应合并为同一事件';
    case 'AI_QUALITY_RELATION_WITHOUT_CASE':
      return '补充案例关联或确认保留';
    case 'AI_QUALITY_TRANSITIVE_SHORTCUT_SUSPECTED':
      return '确认是否存在独立的直接因果依据';
    default:
      return '检查质量报告中的关联候选并修正';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
