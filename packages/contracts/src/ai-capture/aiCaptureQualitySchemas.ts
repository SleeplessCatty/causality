import { z } from 'zod';

export const aiCaptureQualityIssueCodeSchema = z.enum([
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

export const aiCaptureQualitySeveritySchema = z.enum(['error', 'warning']);
export const aiCaptureQualityPhaseSchema = z.enum(['candidate', 'comparison', 'plan']);
export const aiCaptureQualityStatusSchema = z.enum(['passed', 'warning', 'blocked']);
export const aiCaptureQualityEntityTypeSchema = z.enum([
  'batch',
  'event',
  'case',
  'relation',
  'link',
]);

export const aiCaptureQualityIssueSchema = z
  .object({
    code: aiCaptureQualityIssueCodeSchema,
    severity: aiCaptureQualitySeveritySchema,
    phase: aiCaptureQualityPhaseSchema,
    entityType: aiCaptureQualityEntityTypeSchema,
    refs: z.array(z.string()),
    paths: z.array(z.string().startsWith('/')),
    message: z.string(),
    suggestedAction: z.string(),
    aiCanRepair: z.boolean(),
  })
  .strict();

export const aiCaptureTopicRelevanceSignalSchema = z
  .object({
    ref: z.string(),
    similarity: z.number().min(0).max(1),
  })
  .strict();

export const aiCaptureQualityReportSchema = z
  .object({
    version: z.literal(1),
    status: aiCaptureQualityStatusSchema,
    issues: z.array(aiCaptureQualityIssueSchema),
    topicRelevance: z.array(aiCaptureTopicRelevanceSignalSchema),
  })
  .strict();

export type AiCaptureQualityIssueCode = z.infer<typeof aiCaptureQualityIssueCodeSchema>;
export type AiCaptureQualitySeverity = z.infer<typeof aiCaptureQualitySeveritySchema>;
export type AiCaptureQualityPhase = z.infer<typeof aiCaptureQualityPhaseSchema>;
export type AiCaptureQualityStatus = z.infer<typeof aiCaptureQualityStatusSchema>;
export type AiCaptureQualityEntityType = z.infer<typeof aiCaptureQualityEntityTypeSchema>;
export type AiCaptureQualityIssue = z.infer<typeof aiCaptureQualityIssueSchema>;
export type AiCaptureTopicRelevanceSignal = z.infer<typeof aiCaptureTopicRelevanceSignalSchema>;
export type AiCaptureQualityReport = z.infer<typeof aiCaptureQualityReportSchema>;

export const EMPTY_AI_CAPTURE_QUALITY_REPORT = {
  version: 1,
  status: 'passed',
  issues: [],
  topicRelevance: [],
} as const satisfies AiCaptureQualityReport;
