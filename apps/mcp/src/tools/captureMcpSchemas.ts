import { z } from 'zod';

// The canonical business schemas normalize values with Zod transforms, which MCP cannot
// represent as JSON Schema. These transport-only mirrors describe the same wire shape;
// the API remains the canonical cross-field validation and normalization boundary.
const ref = z.string().min(1).max(100);
const eventName = z.string().min(1).max(50);
const eventAlias = z.string().min(1).max(80);
const eventKeyword = z.string().min(1).max(50);
const description = z.string().max(2_000).nullable().optional();
const timestamp = z.iso.datetime({ offset: true });
const count = z.number().int().nonnegative();

// Keep this as a transport-only mirror. The canonical contract schemas use transforms
// that cannot be represented in MCP JSON Schema.
const qualityIssueCode = z.enum([
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

const qualityIssue = z
  .object({
    code: qualityIssueCode,
    severity: z.enum(['error', 'warning']),
    phase: z.enum(['candidate', 'comparison', 'plan']),
    entityType: z.enum(['batch', 'event', 'case', 'relation', 'link']),
    refs: z.array(z.string()),
    paths: z.array(z.string().startsWith('/')),
    message: z.string(),
    suggestedAction: z.string(),
    aiCanRepair: z.boolean(),
  })
  .strict();

const qualityReport = z
  .object({
    version: z.literal(1),
    status: z.enum(['passed', 'warning', 'blocked']),
    issues: z.array(qualityIssue),
    topicRelevance: z.array(
      z
        .object({
          ref: z.string(),
          similarity: z.number().min(0).max(1),
        })
        .strict(),
    ),
  })
  .strict();

const defaultQualityReport = () => ({
  version: 1 as const,
  status: 'passed' as const,
  issues: [],
  topicRelevance: [],
});

const atomicEventCandidate = z
  .object({
    ref,
    name: eventName,
    description,
    aliases: z.array(eventAlias).max(20),
    keywords: z.array(eventKeyword).max(20),
  })
  .strict();

const concreteCaseCandidate = z
  .object({
    ref,
    content: z.string().min(1).max(100),
  })
  .strict();

const causalRelationCandidate = z
  .object({
    ref,
    causeEventRef: ref,
    effectEventRef: ref,
    description,
  })
  .strict();

const relationCaseLinkCandidate = z
  .object({
    relationRef: ref,
    caseRef: ref,
  })
  .strict();

export const captureCandidateSetMcpSchema = z
  .object({
    topic: z.string().min(1).max(200),
    clientName: z.string().min(1).max(100),
    atomicEvents: z.array(atomicEventCandidate).max(50),
    concreteCases: z.array(concreteCaseCandidate),
    causalRelations: z.array(causalRelationCandidate),
    relationCaseLinks: z.array(relationCaseLinkCandidate),
  })
  .strict();

const matchKind = z.enum(['exact_name', 'exact_alias', 'exact_content', 'fuzzy', 'semantic']);
const similarity = z.number().min(0).max(1).nullable();

const eventMatch = z
  .object({
    id: z.uuid(),
    name: eventName,
    description,
    aliases: z.array(eventAlias),
    keywords: z.array(eventKeyword),
    matchKind,
    similarity,
    updatedAt: timestamp,
  })
  .strict();

const caseMatch = z
  .object({
    id: z.uuid(),
    content: z.string().min(1).max(100),
    matchKind,
    similarity,
    updatedAt: timestamp,
  })
  .strict();

const relationMatch = z
  .object({
    id: z.uuid(),
    causeEventId: z.uuid(),
    effectEventId: z.uuid(),
    description,
    confidence: z.number().finite().min(0).max(100),
    caseCount: count,
    updatedAt: timestamp,
  })
  .strict();

const relationComparison = z.discriminatedUnion('status', [
  z.object({ ref, status: z.literal('missing') }).strict(),
  z.object({ ref, status: z.literal('existing'), relation: relationMatch }).strict(),
  z.object({ ref, status: z.literal('reverse'), relation: relationMatch }).strict(),
]);

export const captureComparisonMcpSchema = z
  .object({
    atomicEvents: z.array(z.object({ ref, matches: z.array(eventMatch).max(10) }).strict()),
    concreteCases: z.array(z.object({ ref, matches: z.array(caseMatch).max(10) }).strict()),
    causalRelations: z.array(relationComparison),
    relationCaseLinks: z.array(
      z.object({ relationRef: ref, caseRef: ref, exists: z.boolean() }).strict(),
    ),
    qualityReport: qualityReport.default(defaultQualityReport),
  })
  .strict();

const eventDecision = z.discriminatedUnion('action', [
  z.object({ ref, action: z.literal('create') }).strict(),
  z
    .object({
      ref,
      action: z.literal('reuse'),
      existingId: z.uuid(),
      appendAliases: z.array(eventAlias).max(20),
      appendKeywords: z.array(eventKeyword).max(20),
      replaceDescription: description,
    })
    .strict(),
  z.object({ ref, action: z.literal('skip'), reason: z.string().min(1).max(1_000) }).strict(),
]);

const caseDecision = z.discriminatedUnion('action', [
  z.object({ ref, action: z.literal('create') }).strict(),
  z.object({ ref, action: z.literal('reuse'), existingId: z.uuid() }).strict(),
  z.object({ ref, action: z.literal('skip'), reason: z.string().min(1).max(1_000) }).strict(),
]);

const relationDecision = z.discriminatedUnion('action', [
  z.object({ ref, action: z.literal('create') }).strict(),
  z.object({ ref, action: z.literal('reuse'), existingId: z.uuid() }).strict(),
  z.object({ ref, action: z.literal('skip'), reason: z.string().min(1).max(1_000) }).strict(),
]);

const linkDecision = z.discriminatedUnion('action', [
  z.object({ relationRef: ref, caseRef: ref, action: z.literal('create') }).strict(),
  z.object({ relationRef: ref, caseRef: ref, action: z.literal('reuse') }).strict(),
  z
    .object({
      relationRef: ref,
      caseRef: ref,
      action: z.literal('skip'),
      reason: z.string().min(1).max(1_000),
    })
    .strict(),
]);

const decisionSet = z
  .object({
    atomicEvents: z.array(eventDecision),
    concreteCases: z.array(caseDecision),
    causalRelations: z.array(relationDecision),
    relationCaseLinks: z.array(linkDecision),
  })
  .strict();

export const prepareImportPlanMcpSchema = z
  .object({
    candidates: captureCandidateSetMcpSchema,
    comparison: captureComparisonMcpSchema,
    decisions: decisionSet,
    replacesPlanId: z.uuid().optional(),
  })
  .strict();

const changeCounts = z
  .object({
    eventCreated: count,
    eventReused: count,
    eventUpdated: count,
    caseCreated: count,
    caseReused: count,
    relationCreated: count,
    relationReused: count,
    relationCaseCreated: count,
    relationCaseReused: count,
    confidenceChanged: count,
  })
  .strict();

const workflowError = z
  .object({
    category: z.enum(['data', 'system', 'configuration']),
    code: z.string().min(1),
    message: z.string().min(1),
    affectedRefs: z.array(z.string()),
    aiCanRepair: z.boolean(),
    retryCurrentPlan: z.boolean(),
    suggestedAction: z.string().min(1),
    qualityReport: qualityReport.optional(),
  })
  .strict();

export const importCommitResultMcpSchema = z
  .object({
    planId: z.uuid(),
    historyId: z.uuid(),
    marker: z.string().min(1).max(100),
    noChanges: z.boolean(),
    counts: changeCounts,
    completedAt: timestamp,
  })
  .strict();

const planStatus = z.enum([
  'pending',
  'replaced',
  'invalidated',
  'expired',
  'submitting',
  'committed',
  'data_failed',
  'system_failed',
]);

export const importPlanMcpSchema = z
  .object({
    id: z.uuid(),
    version: z.number().int().positive(),
    replacesPlanId: z.uuid().nullable(),
    status: planStatus,
    topic: z.string().min(1).max(200),
    clientName: z.string().min(1).max(100),
    candidates: captureCandidateSetMcpSchema,
    comparison: captureComparisonMcpSchema,
    decisions: decisionSet,
    summary: changeCounts,
    createdAt: timestamp,
    expiresAt: timestamp,
    committedAt: timestamp.nullable(),
    error: workflowError.nullable(),
    result: importCommitResultMcpSchema.nullable(),
  })
  .strict();

export const importPlanStatusMcpSchema = z
  .object({
    planId: z.uuid(),
    status: planStatus,
  })
  .strict();
