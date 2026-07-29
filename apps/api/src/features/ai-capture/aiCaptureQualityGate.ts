import {
  type AiCaptureCandidateSet,
  type AiCaptureQualityEntityType,
  type AiCaptureQualityIssue,
  type AiCaptureQualityIssueCode,
  type AiCaptureQualityReport,
  type AiCaptureQualitySeverity,
  type AiCaptureTopicRelevanceSignal,
} from '@causality/contracts';
import type { z } from 'zod';

const severityRank = { error: 0, warning: 1 } as const;
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
        entityType: entityTypeFromPath(issue.path),
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

  return issue.code === 'too_big' && issue.path[0] === 'atomicEvents'
    ? 'AI_QUALITY_EVENT_LIMIT_EXCEEDED'
    : 'AI_QUALITY_SCHEMA_INVALID';
}

function isQualityCode(value: unknown): value is AiCaptureQualityIssueCode {
  return typeof value === 'string' && qualityCodes.has(value as AiCaptureQualityIssueCode);
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
