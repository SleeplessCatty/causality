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
  candidates: readonly ComparisonCandidate[];
  section: 'atomicEvents' | 'concreteCases';
  code: AiCaptureQualityIssueCode;
  entityType: Extract<AiCaptureQualityEntityType, 'event' | 'case'>;
  message: string;
  matchPathSuffix: '/matches' | '/matches/0';
  matchingId(candidate: ComparisonCandidate): string | null;
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
    return buildQualityReport([
      ...duplicateEventNameIssues(input),
      ...duplicateCaseContentIssues(input),
      ...duplicateRelationIssues(input),
      ...orphanEventIssues(input),
      ...orphanCaseIssues(input),
      ...candidateWarningIssues(input),
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
        ...sharedExactMatchIssues(input.comparison),
        ...sharedSemanticMatchIssues(input.comparison),
      ],
      input.topicRelevance,
    );
  }

  public inspectPlan(input: PrepareAiImportPlanInput): AiCaptureQualityReport {
    const candidateReport = this.inspectCandidates(input.candidates);
    const comparisonReport = buildQualityReport([
      ...sharedExactMatchIssues(input.comparison),
      ...sharedSemanticMatchIssues(input.comparison),
    ]);
    const candidateIssues = candidateReport.issues
      .filter((issue) => issue.code !== 'AI_QUALITY_RELATION_WITHOUT_CASE')
      .map((issue) => issueForPlan(input, issue));
    const comparisonWarnings = comparisonReport.issues.map((issue) => issueForPlan(input, issue));
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
      ...planDecisionIssues(input),
    ]);
  }
}

function issueForPlan(
  input: PrepareAiImportPlanInput,
  issue: AiCaptureQualityIssue,
): AiCaptureQualityIssue {
  return planIssue({
    code: issue.code,
    severity: issue.severity,
    entityType: issue.entityType,
    refs: issue.refs,
    paths: decisionPaths(input, issue.entityType, issue.refs),
    message: issue.message,
  });
}

function planDecisionIssues(input: PrepareAiImportPlanInput): AiCaptureQualityIssue[] {
  const eventDecisions = new Map(
    input.decisions.atomicEvents.map((decision, index) => [decision.ref, { decision, index }]),
  );
  const caseDecisions = new Map(
    input.decisions.concreteCases.map((decision, index) => [decision.ref, { decision, index }]),
  );
  const relationDecisions = new Map(
    input.decisions.causalRelations.map((decision, index) => [decision.ref, { decision, index }]),
  );
  const linkDecisions = new Map(
    input.decisions.relationCaseLinks.map((decision, index) => [
      relationKey(decision.relationRef, decision.caseRef),
      { decision, index },
    ]),
  );
  const activeRelationRefs = new Set(
    input.decisions.causalRelations.flatMap((decision) =>
      decision.action === 'skip' ? [] : [decision.ref],
    ),
  );
  const activeLinkKeys = new Set(
    input.decisions.relationCaseLinks.flatMap((decision) =>
      decision.action === 'skip' ? [] : [relationKey(decision.relationRef, decision.caseRef)],
    ),
  );
  const connectedEventRefs = new Set(
    input.candidates.causalRelations.flatMap((relation) =>
      activeRelationRefs.has(relation.ref) ? [relation.causeEventRef, relation.effectEventRef] : [],
    ),
  );
  const linkedCaseRefs = new Set(
    input.candidates.relationCaseLinks.flatMap((link) =>
      activeLinkKeys.has(relationKey(link.relationRef, link.caseRef)) ? [link.caseRef] : [],
    ),
  );
  const linkedRelationRefs = new Set(
    input.candidates.relationCaseLinks.flatMap((link) =>
      activeLinkKeys.has(relationKey(link.relationRef, link.caseRef)) ? [link.relationRef] : [],
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
    const relationEntry = relationDecisions.get(relation.ref);
    if (!relationEntry || relationEntry.decision.action === 'skip') return;
    const skippedEventRefs = [relation.causeEventRef, relation.effectEventRef].filter(
      (ref) => eventDecisions.get(ref)?.decision.action === 'skip',
    );
    if (skippedEventRefs.length === 0) return;
    issues.push(
      planIssue({
        code: 'AI_QUALITY_DECISION_DEPENDENCY_INVALID',
        severity: 'error',
        entityType: 'relation',
        refs: [relation.ref, ...skippedEventRefs],
        paths: [
          `/decisions/causalRelations/${relationEntry.index}`,
          ...skippedEventRefs.flatMap((ref) => {
            const entry = eventDecisions.get(ref);
            return entry ? [`/decisions/atomicEvents/${entry.index}`] : [];
          }),
        ],
        message: '有效因果关系依赖已跳过的原子事件决策',
      }),
    );
  });

  input.candidates.relationCaseLinks.forEach((link) => {
    const key = relationKey(link.relationRef, link.caseRef);
    const linkEntry = linkDecisions.get(key);
    if (!linkEntry || linkEntry.decision.action === 'skip') return;
    const relationEntry = relationDecisions.get(link.relationRef);
    const caseEntry = caseDecisions.get(link.caseRef);
    const relationSkipped = relationEntry?.decision.action === 'skip';
    const caseSkipped = caseEntry?.decision.action === 'skip';
    if (!relationSkipped && !caseSkipped) return;
    issues.push(
      planIssue({
        code: 'AI_QUALITY_DECISION_DEPENDENCY_INVALID',
        severity: 'error',
        entityType: 'link',
        refs: [link.relationRef, link.caseRef],
        paths: [
          `/decisions/relationCaseLinks/${linkEntry.index}`,
          ...(relationSkipped && relationEntry
            ? [`/decisions/causalRelations/${relationEntry.index}`]
            : []),
          ...(caseSkipped && caseEntry ? [`/decisions/concreteCases/${caseEntry.index}`] : []),
        ],
        message: '有效案例关联依赖已跳过的因果关系或具体案例决策',
      }),
    );
  });

  return issues;
}

function decisionPaths(
  input: PrepareAiImportPlanInput,
  entityType: AiCaptureQualityEntityType,
  refs: readonly string[],
): string[] {
  const refSet = new Set(refs);
  switch (entityType) {
    case 'event':
      return input.decisions.atomicEvents.flatMap((decision, index) =>
        refSet.has(decision.ref) ? [`/decisions/atomicEvents/${index}`] : [],
      );
    case 'case':
      return input.decisions.concreteCases.flatMap((decision, index) =>
        refSet.has(decision.ref) ? [`/decisions/concreteCases/${index}`] : [],
      );
    case 'relation':
      return input.decisions.causalRelations.flatMap((decision, index) =>
        refSet.has(decision.ref) ? [`/decisions/causalRelations/${index}`] : [],
      );
    case 'link':
      return input.decisions.relationCaseLinks.flatMap((decision, index) =>
        refSet.has(decision.relationRef) && refSet.has(decision.caseRef)
          ? [`/decisions/relationCaseLinks/${index}`]
          : [],
      );
    case 'batch':
      return ['/decisions'];
  }
}

function sharedExactMatchIssues(comparison: AiCaptureComparison): AiCaptureQualityIssue[] {
  return [
    ...sharedMatchIssues({
      candidates: comparison.atomicEvents,
      section: 'atomicEvents',
      code: 'AI_QUALITY_EVENTS_SHARE_EXACT_MATCH',
      entityType: 'event',
      message: '多个原子事件候选唯一精确匹配同一已有原子事件',
      matchPathSuffix: '/matches',
      matchingId: (candidate) => uniqueExactMatchId(candidate.matches),
    }),
    ...sharedMatchIssues({
      candidates: comparison.concreteCases,
      section: 'concreteCases',
      code: 'AI_QUALITY_CASES_SHARE_EXACT_MATCH',
      entityType: 'case',
      message: '多个具体案例候选唯一精确匹配同一已有具体案例',
      matchPathSuffix: '/matches',
      matchingId: (candidate) => uniqueExactMatchId(candidate.matches),
    }),
  ];
}

function sharedSemanticMatchIssues(comparison: AiCaptureComparison): AiCaptureQualityIssue[] {
  return [
    ...sharedMatchIssues({
      candidates: comparison.atomicEvents,
      section: 'atomicEvents',
      code: 'AI_QUALITY_EVENT_SEMANTIC_DUPLICATE_SUSPECTED',
      entityType: 'event',
      message: '多个原子事件候选高相似指向同一已有原子事件',
      matchPathSuffix: '/matches/0',
      matchingId: qualifyingSemanticMatchId,
    }),
    ...sharedMatchIssues({
      candidates: comparison.concreteCases,
      section: 'concreteCases',
      code: 'AI_QUALITY_CASE_SEMANTIC_DUPLICATE_SUSPECTED',
      entityType: 'case',
      message: '多个具体案例候选高相似指向同一已有具体案例',
      matchPathSuffix: '/matches/0',
      matchingId: qualifyingSemanticMatchId,
    }),
  ];
}

function sharedMatchIssues(options: SharedMatchIssueOptions): AiCaptureQualityIssue[] {
  const byExistingId = new Map<string, Array<{ ref: string; index: number }>>();
  options.candidates.forEach((candidate, index) => {
    const existingId = options.matchingId(candidate);
    if (!existingId) return;
    const refs = byExistingId.get(existingId) ?? [];
    refs.push({ ref: candidate.ref, index });
    byExistingId.set(existingId, refs);
  });

  return [...byExistingId.values()].flatMap((matches) =>
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

function duplicateEventNameIssues(input: AiCaptureCandidateSet): AiCaptureQualityIssue[] {
  const seen = new Set<string>();
  const issues: AiCaptureQualityIssue[] = [];

  input.atomicEvents.forEach((event, index) => {
    const name = normalizeEventName(event.name);
    if (seen.has(name)) {
      issues.push(
        candidateIssue({
          code: 'AI_QUALITY_DUPLICATE_EVENT_NAME',
          severity: 'error',
          entityType: 'event',
          refs: [event.ref],
          path: `/atomicEvents/${index}/name`,
          message: '候选原子事件名称重复',
        }),
      );
    }
    seen.add(name);
  });

  return issues;
}

function duplicateCaseContentIssues(input: AiCaptureCandidateSet): AiCaptureQualityIssue[] {
  const seen = new Set<string>();
  const issues: AiCaptureQualityIssue[] = [];

  input.concreteCases.forEach((concreteCase, index) => {
    const content = concreteCase.content.trim();
    if (seen.has(content)) {
      issues.push(
        candidateIssue({
          code: 'AI_QUALITY_DUPLICATE_CASE_CONTENT',
          severity: 'error',
          entityType: 'case',
          refs: [concreteCase.ref],
          path: `/concreteCases/${index}/content`,
          message: '候选具体案例内容重复',
        }),
      );
    }
    seen.add(content);
  });

  return issues;
}

function duplicateRelationIssues(input: AiCaptureCandidateSet): AiCaptureQualityIssue[] {
  const seen = new Set<string>();
  const issues: AiCaptureQualityIssue[] = [];

  input.causalRelations.forEach((relation, index) => {
    const key = relationKey(relation.causeEventRef, relation.effectEventRef);
    if (seen.has(key)) {
      issues.push(
        candidateIssue({
          code: 'AI_QUALITY_DUPLICATE_RELATION',
          severity: 'error',
          entityType: 'relation',
          refs: [relation.ref],
          path: `/causalRelations/${index}`,
          message: '候选因果关系重复',
        }),
      );
    }
    seen.add(key);
  });

  return issues;
}

function orphanEventIssues(input: AiCaptureCandidateSet): AiCaptureQualityIssue[] {
  const connectedRefs = new Set(
    input.causalRelations.flatMap((relation) => [relation.causeEventRef, relation.effectEventRef]),
  );

  return input.atomicEvents.flatMap((event, index) =>
    connectedRefs.has(event.ref)
      ? []
      : [
          candidateIssue({
            code: 'AI_QUALITY_ORPHAN_EVENT',
            severity: 'error',
            entityType: 'event',
            refs: [event.ref],
            path: `/atomicEvents/${index}`,
            message: '候选原子事件尚未关联因果关系',
          }),
        ],
  );
}

function orphanCaseIssues(input: AiCaptureCandidateSet): AiCaptureQualityIssue[] {
  const linkedRefs = new Set(input.relationCaseLinks.map((link) => link.caseRef));

  return input.concreteCases.flatMap((concreteCase, index) =>
    linkedRefs.has(concreteCase.ref)
      ? []
      : [
          candidateIssue({
            code: 'AI_QUALITY_ORPHAN_CASE',
            severity: 'error',
            entityType: 'case',
            refs: [concreteCase.ref],
            path: `/concreteCases/${index}`,
            message: '候选具体案例尚未关联因果关系',
          }),
        ],
  );
}

function candidateWarningIssues(input: AiCaptureCandidateSet): AiCaptureQualityIssue[] {
  return [
    ...compoundEventIssues(input),
    ...aliasCollisionIssues(input),
    ...relationWithoutCaseIssues(input),
    ...transitiveShortcutIssues(input),
  ];
}

function compoundEventIssues(input: AiCaptureCandidateSet): AiCaptureQualityIssue[] {
  return input.atomicEvents.flatMap((event, index) =>
    isCompoundEvent(event.name)
      ? [
          candidateIssue({
            code: 'AI_QUALITY_COMPOUND_EVENT_SUSPECTED',
            severity: 'warning',
            entityType: 'event',
            refs: [event.ref],
            path: `/atomicEvents/${index}/name`,
            message: '候选原子事件可能包含多个独立变化',
          }),
        ]
      : [],
  );
}

function aliasCollisionIssues(input: AiCaptureCandidateSet): AiCaptureQualityIssue[] {
  const seen = new Map<string, { ref: string; isAlias: boolean }>();
  const issues: AiCaptureQualityIssue[] = [];

  input.atomicEvents.forEach((event, eventIndex) => {
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

function relationWithoutCaseIssues(input: AiCaptureCandidateSet): AiCaptureQualityIssue[] {
  const linkedRelations = new Set(input.relationCaseLinks.map((link) => link.relationRef));

  return input.causalRelations.flatMap((relation, index) =>
    linkedRelations.has(relation.ref)
      ? []
      : [
          candidateIssue({
            code: 'AI_QUALITY_RELATION_WITHOUT_CASE',
            severity: 'warning',
            entityType: 'relation',
            refs: [relation.ref],
            path: `/causalRelations/${index}`,
            message: '候选因果关系尚未关联具体案例',
          }),
        ],
  );
}

function transitiveShortcutIssues(input: AiCaptureCandidateSet): AiCaptureQualityIssue[] {
  const endpointKeys = new Set(
    input.causalRelations.map((relation) =>
      relationKey(relation.causeEventRef, relation.effectEventRef),
    ),
  );

  return input.causalRelations.flatMap((relation, index) => {
    const hasShortcut = input.causalRelations.some(
      (first) =>
        first.causeEventRef === relation.causeEventRef &&
        first.effectEventRef !== relation.effectEventRef &&
        endpointKeys.has(relationKey(first.effectEventRef, relation.effectEventRef)),
    );

    return hasShortcut
      ? [
          candidateIssue({
            code: 'AI_QUALITY_TRANSITIVE_SHORTCUT_SUSPECTED',
            severity: 'warning',
            entityType: 'relation',
            refs: [relation.ref],
            path: `/causalRelations/${index}`,
            message: '候选因果关系可能是传递路径的快捷边',
          }),
        ]
      : [];
  });
}

function isCompoundEvent(name: string): boolean {
  if (!compoundConnectorPattern.test(name)) return false;

  return (
    name.split(compoundSplitPattern).filter((part) => changePhrasePattern.test(part)).length >= 2
  );
}

function normalizeEventName(value: string): string {
  return value.trim().toLocaleLowerCase('zh-CN');
}

function relationKey(causeEventRef: string, effectEventRef: string): string {
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
