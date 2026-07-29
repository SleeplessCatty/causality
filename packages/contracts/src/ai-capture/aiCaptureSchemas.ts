import { z } from 'zod';

import { caseContentSchema } from '../cases/caseSchemas.js';
import { eventAliasSchema, eventKeywordSchema, eventNameSchema } from '../events/eventSchemas.js';
import { MAIN_LIST_PAGE_SIZE } from '../pagination/pageSchemas.js';
import {
  relationConfidenceSchema,
  relationDescriptionSchema,
} from '../relations/relationSchemas.js';

export const MAX_AI_CAPTURE_EVENTS = 50;

const timestampSchema = z.iso.datetime({ offset: true });
const candidateRefSchema = z.string().trim().min(1).max(100);
const topicSchema = z.string().trim().min(1).max(200);
const clientNameSchema = z.string().trim().min(1).max(100);
const descriptionInputSchema = z
  .string()
  .trim()
  .max(2_000)
  .nullable()
  .optional()
  .transform((value) => value || null);
const descriptionOutputSchema = z.string().max(2_000).nullable();
const nonnegativeCountSchema = z.number().int().nonnegative();
const fixedPageSizeSchema = z.literal(MAIN_LIST_PAGE_SIZE);

export const atomicEventCandidateSchema = z
  .object({
    ref: candidateRefSchema,
    name: eventNameSchema,
    description: descriptionInputSchema,
    aliases: z.array(eventAliasSchema).max(20).default([]),
    keywords: z.array(eventKeywordSchema).max(20).default([]),
  })
  .strict();

export const atomicEventCandidateOutputSchema = z
  .object({
    ref: candidateRefSchema,
    name: eventNameSchema,
    description: descriptionOutputSchema,
    aliases: z.array(eventAliasSchema).max(20),
    keywords: z.array(eventKeywordSchema).max(20),
  })
  .strict();

export const concreteCaseCandidateSchema = z
  .object({
    ref: candidateRefSchema,
    content: caseContentSchema,
  })
  .strict();

export const causalRelationCandidateSchema = z
  .object({
    ref: candidateRefSchema,
    causeEventRef: candidateRefSchema,
    effectEventRef: candidateRefSchema,
    description: relationDescriptionSchema,
  })
  .strict();

export const causalRelationCandidateOutputSchema = z
  .object({
    ref: candidateRefSchema,
    causeEventRef: candidateRefSchema,
    effectEventRef: candidateRefSchema,
    description: descriptionOutputSchema,
  })
  .strict();

export const relationCaseLinkCandidateSchema = z
  .object({
    relationRef: candidateRefSchema,
    caseRef: candidateRefSchema,
  })
  .strict();

function addDuplicateRefIssues(
  values: readonly { ref: string }[],
  path: string,
  context: z.core.$RefinementCtx,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value.ref)) {
      context.addIssue({
        code: 'custom',
        message: `候选引用 ${value.ref} 重复`,
        path: [path, index, 'ref'],
      });
    }
    seen.add(value.ref);
  });
}

interface CandidateSetReferences {
  atomicEvents: readonly { ref: string }[];
  concreteCases: readonly { ref: string }[];
  causalRelations: readonly {
    ref: string;
    causeEventRef: string;
    effectEventRef: string;
  }[];
  relationCaseLinks: readonly {
    relationRef: string;
    caseRef: string;
  }[];
}

function addCandidateSetReferenceIssues(
  value: CandidateSetReferences,
  context: z.core.$RefinementCtx,
): void {
  addDuplicateRefIssues(value.atomicEvents, 'atomicEvents', context);
  addDuplicateRefIssues(value.concreteCases, 'concreteCases', context);
  addDuplicateRefIssues(value.causalRelations, 'causalRelations', context);

  const eventRefs = new Set(value.atomicEvents.map((event) => event.ref));
  const caseRefs = new Set(value.concreteCases.map((concreteCase) => concreteCase.ref));
  const relationRefs = new Set(value.causalRelations.map((relation) => relation.ref));

  value.causalRelations.forEach((relation, index) => {
    if (!eventRefs.has(relation.causeEventRef)) {
      context.addIssue({
        code: 'custom',
        message: `原因事件引用 ${relation.causeEventRef} 不存在`,
        path: ['causalRelations', index, 'causeEventRef'],
      });
    }
    if (!eventRefs.has(relation.effectEventRef)) {
      context.addIssue({
        code: 'custom',
        message: `结果事件引用 ${relation.effectEventRef} 不存在`,
        path: ['causalRelations', index, 'effectEventRef'],
      });
    }
    if (relation.causeEventRef === relation.effectEventRef) {
      context.addIssue({
        code: 'custom',
        message: '因果关系不能形成自环',
        path: ['causalRelations', index, 'effectEventRef'],
      });
    }
  });

  const linkKeys = new Set<string>();
  value.relationCaseLinks.forEach((link, index) => {
    if (!relationRefs.has(link.relationRef)) {
      context.addIssue({
        code: 'custom',
        message: `因果关系引用 ${link.relationRef} 不存在`,
        path: ['relationCaseLinks', index, 'relationRef'],
      });
    }
    if (!caseRefs.has(link.caseRef)) {
      context.addIssue({
        code: 'custom',
        message: `具体案例引用 ${link.caseRef} 不存在`,
        path: ['relationCaseLinks', index, 'caseRef'],
      });
    }
    const key = `${link.relationRef}\u0000${link.caseRef}`;
    if (linkKeys.has(key)) {
      context.addIssue({
        code: 'custom',
        message: '候选案例关联重复',
        path: ['relationCaseLinks', index],
      });
    }
    linkKeys.add(key);
  });
}

export const aiCaptureCandidateSetInputSchema = z
  .object({
    topic: topicSchema,
    clientName: clientNameSchema,
    atomicEvents: z.array(atomicEventCandidateSchema).max(MAX_AI_CAPTURE_EVENTS),
    concreteCases: z.array(concreteCaseCandidateSchema),
    causalRelations: z.array(causalRelationCandidateSchema),
    relationCaseLinks: z.array(relationCaseLinkCandidateSchema),
  })
  .strict()
  .superRefine(addCandidateSetReferenceIssues);

// Backward-compatible input alias for existing callers.
export const aiCaptureCandidateSetSchema = aiCaptureCandidateSetInputSchema;

export const aiCaptureCandidateSetOutputSchema = z
  .object({
    topic: topicSchema,
    clientName: clientNameSchema,
    atomicEvents: z.array(atomicEventCandidateOutputSchema).max(MAX_AI_CAPTURE_EVENTS),
    concreteCases: z.array(concreteCaseCandidateSchema),
    causalRelations: z.array(causalRelationCandidateOutputSchema),
    relationCaseLinks: z.array(relationCaseLinkCandidateSchema),
  })
  .strict()
  .superRefine(addCandidateSetReferenceIssues);

export const aiMatchKindSchema = z.enum([
  'exact_name',
  'exact_alias',
  'exact_content',
  'fuzzy',
  'semantic',
]);

const similaritySchema = z.number().min(0).max(1).nullable();

export const aiEventMatchSchema = z
  .object({
    id: z.uuid(),
    name: eventNameSchema,
    description: descriptionOutputSchema,
    aliases: z.array(eventAliasSchema),
    keywords: z.array(eventKeywordSchema),
    matchKind: aiMatchKindSchema,
    similarity: similaritySchema,
    updatedAt: timestampSchema,
  })
  .strict();

export const aiCaseMatchSchema = z
  .object({
    id: z.uuid(),
    content: caseContentSchema,
    matchKind: aiMatchKindSchema,
    similarity: similaritySchema,
    updatedAt: timestampSchema,
  })
  .strict();

export const aiRelationMatchSchema = z
  .object({
    id: z.uuid(),
    causeEventId: z.uuid(),
    effectEventId: z.uuid(),
    description: descriptionOutputSchema,
    confidence: relationConfidenceSchema,
    caseCount: nonnegativeCountSchema,
    updatedAt: timestampSchema,
  })
  .strict();

const eventComparisonSchema = z
  .object({
    ref: candidateRefSchema,
    matches: z.array(aiEventMatchSchema).max(10),
  })
  .strict();

const caseComparisonSchema = z
  .object({
    ref: candidateRefSchema,
    matches: z.array(aiCaseMatchSchema).max(10),
  })
  .strict();

const relationComparisonSchema = z.discriminatedUnion('status', [
  z.object({ ref: candidateRefSchema, status: z.literal('missing') }).strict(),
  z
    .object({
      ref: candidateRefSchema,
      status: z.literal('existing'),
      relation: aiRelationMatchSchema,
    })
    .strict(),
  z
    .object({
      ref: candidateRefSchema,
      status: z.literal('reverse'),
      relation: aiRelationMatchSchema,
    })
    .strict(),
]);

const linkComparisonSchema = z
  .object({
    relationRef: candidateRefSchema,
    caseRef: candidateRefSchema,
    exists: z.boolean(),
  })
  .strict();

export const aiCaptureComparisonSchema = z
  .object({
    atomicEvents: z.array(eventComparisonSchema),
    concreteCases: z.array(caseComparisonSchema),
    causalRelations: z.array(relationComparisonSchema),
    relationCaseLinks: z.array(linkComparisonSchema),
  })
  .strict();

export const aiEventDecisionSchema = z.discriminatedUnion('action', [
  z.object({ ref: candidateRefSchema, action: z.literal('create') }).strict(),
  z
    .object({
      ref: candidateRefSchema,
      action: z.literal('reuse'),
      existingId: z.uuid(),
      appendAliases: z.array(eventAliasSchema).max(20),
      appendKeywords: z.array(eventKeywordSchema).max(20),
      replaceDescription: descriptionInputSchema.optional(),
    })
    .strict(),
  z
    .object({
      ref: candidateRefSchema,
      action: z.literal('skip'),
      reason: z.string().trim().min(1).max(1_000),
    })
    .strict(),
]);

export const aiEventDecisionOutputSchema = z.discriminatedUnion('action', [
  z.object({ ref: candidateRefSchema, action: z.literal('create') }).strict(),
  z
    .object({
      ref: candidateRefSchema,
      action: z.literal('reuse'),
      existingId: z.uuid(),
      appendAliases: z.array(eventAliasSchema).max(20),
      appendKeywords: z.array(eventKeywordSchema).max(20),
      replaceDescription: descriptionOutputSchema.optional(),
    })
    .strict(),
  z
    .object({
      ref: candidateRefSchema,
      action: z.literal('skip'),
      reason: z.string().min(1).max(1_000),
    })
    .strict(),
]);

export const aiCaseDecisionSchema = z.discriminatedUnion('action', [
  z.object({ ref: candidateRefSchema, action: z.literal('create') }).strict(),
  z
    .object({
      ref: candidateRefSchema,
      action: z.literal('reuse'),
      existingId: z.uuid(),
    })
    .strict(),
  z
    .object({
      ref: candidateRefSchema,
      action: z.literal('skip'),
      reason: z.string().trim().min(1).max(1_000),
    })
    .strict(),
]);

export const aiRelationDecisionSchema = z.discriminatedUnion('action', [
  z.object({ ref: candidateRefSchema, action: z.literal('create') }).strict(),
  z
    .object({
      ref: candidateRefSchema,
      action: z.literal('reuse'),
      existingId: z.uuid(),
    })
    .strict(),
  z
    .object({
      ref: candidateRefSchema,
      action: z.literal('skip'),
      reason: z.string().trim().min(1).max(1_000),
    })
    .strict(),
]);

export const aiLinkDecisionSchema = z.discriminatedUnion('action', [
  z
    .object({
      relationRef: candidateRefSchema,
      caseRef: candidateRefSchema,
      action: z.literal('create'),
    })
    .strict(),
  z
    .object({
      relationRef: candidateRefSchema,
      caseRef: candidateRefSchema,
      action: z.literal('reuse'),
    })
    .strict(),
  z
    .object({
      relationRef: candidateRefSchema,
      caseRef: candidateRefSchema,
      action: z.literal('skip'),
      reason: z.string().trim().min(1).max(1_000),
    })
    .strict(),
]);

export const aiCaptureDecisionSetInputSchema = z
  .object({
    atomicEvents: z.array(aiEventDecisionSchema),
    concreteCases: z.array(aiCaseDecisionSchema),
    causalRelations: z.array(aiRelationDecisionSchema),
    relationCaseLinks: z.array(aiLinkDecisionSchema),
  })
  .strict();

// Backward-compatible input alias for existing callers.
export const aiCaptureDecisionSetSchema = aiCaptureDecisionSetInputSchema;

export const aiCaptureDecisionSetOutputSchema = z
  .object({
    atomicEvents: z.array(aiEventDecisionOutputSchema),
    concreteCases: z.array(aiCaseDecisionSchema),
    causalRelations: z.array(aiRelationDecisionSchema),
    relationCaseLinks: z.array(aiLinkDecisionSchema),
  })
  .strict();

export const prepareAiImportPlanInputSchema = z
  .object({
    candidates: aiCaptureCandidateSetInputSchema,
    comparison: aiCaptureComparisonSchema,
    decisions: aiCaptureDecisionSetInputSchema,
    replacesPlanId: z.uuid().optional(),
  })
  .strict();

export const aiImportPlanStatusSchema = z.enum([
  'pending',
  'replaced',
  'invalidated',
  'expired',
  'submitting',
  'committed',
  'data_failed',
  'system_failed',
]);

export const aiWorkflowErrorSchema = z
  .object({
    category: z.enum(['data', 'system', 'configuration']),
    code: z.string().min(1),
    message: z.string().min(1),
    affectedRefs: z.array(z.string()).default([]),
    aiCanRepair: z.boolean(),
    retryCurrentPlan: z.boolean(),
    suggestedAction: z.string().min(1),
  })
  .strict();

export const aiImportChangeCountsSchema = z
  .object({
    eventCreated: nonnegativeCountSchema,
    eventReused: nonnegativeCountSchema,
    eventUpdated: nonnegativeCountSchema,
    caseCreated: nonnegativeCountSchema,
    caseReused: nonnegativeCountSchema,
    relationCreated: nonnegativeCountSchema,
    relationReused: nonnegativeCountSchema,
    relationCaseCreated: nonnegativeCountSchema,
    relationCaseReused: nonnegativeCountSchema.default(0),
    confidenceChanged: nonnegativeCountSchema,
  })
  .strict();

export const aiImportCommitResultSchema = z
  .object({
    planId: z.uuid(),
    historyId: z.uuid(),
    marker: z.string().trim().min(1).max(100),
    noChanges: z.boolean(),
    counts: aiImportChangeCountsSchema,
    completedAt: timestampSchema,
  })
  .strict();

export const aiImportPlanSchema = z
  .object({
    id: z.uuid(),
    version: z.number().int().positive(),
    replacesPlanId: z.uuid().nullable(),
    status: aiImportPlanStatusSchema,
    topic: topicSchema,
    clientName: clientNameSchema,
    candidates: aiCaptureCandidateSetOutputSchema,
    comparison: aiCaptureComparisonSchema,
    decisions: aiCaptureDecisionSetOutputSchema,
    summary: aiImportChangeCountsSchema,
    createdAt: timestampSchema,
    expiresAt: timestampSchema,
    committedAt: timestampSchema.nullable(),
    error: aiWorkflowErrorSchema.nullable(),
    result: aiImportCommitResultSchema.nullable(),
  })
  .strict();

export const aiImportBatchSummarySchema = z
  .object({
    id: z.uuid(),
    planId: z.uuid(),
    topic: topicSchema,
    planVersion: z.number().int().positive(),
    clientName: clientNameSchema,
    completedAt: timestampSchema,
    counts: aiImportChangeCountsSchema,
  })
  .strict();

export const aiImportBatchListResponseSchema = z
  .object({
    items: z.array(aiImportBatchSummarySchema),
    page: z.number().int().min(1),
    pageSize: fixedPageSizeSchema,
    totalItems: nonnegativeCountSchema,
    totalPages: z.number().int().min(1),
  })
  .strict();

export const aiImportBatchDetailSchema = aiImportBatchSummarySchema;

export const aiImportRecordTypeSchema = z.enum([
  'event',
  'case',
  'relation',
  'relation_case',
  'confidence',
]);

export const aiImportRecordActionSchema = z.enum(['created', 'reused', 'updated', 'changed']);

export const aiImportRecordSchema = z
  .object({
    id: z.uuid(),
    sequence: z.number().int().positive(),
    recordType: aiImportRecordTypeSchema,
    action: aiImportRecordActionSchema,
    primaryRecordId: z.uuid(),
    relatedRecordId: z.uuid().nullable(),
    detail: z.record(z.string(), z.unknown()),
  })
  .strict();

export const aiImportRecordListResponseSchema = z
  .object({
    items: z.array(aiImportRecordSchema),
    page: z.number().int().min(1),
    pageSize: fixedPageSizeSchema,
    totalItems: nonnegativeCountSchema,
    totalPages: z.number().int().min(1),
  })
  .strict();

export type AtomicEventCandidate = z.infer<typeof atomicEventCandidateSchema>;
export type ConcreteCaseCandidate = z.infer<typeof concreteCaseCandidateSchema>;
export type CausalRelationCandidate = z.infer<typeof causalRelationCandidateSchema>;
export type RelationCaseLinkCandidate = z.infer<typeof relationCaseLinkCandidateSchema>;
export type AiCaptureCandidateSet = z.infer<typeof aiCaptureCandidateSetInputSchema>;
export type AiCaptureComparison = z.infer<typeof aiCaptureComparisonSchema>;
export type AiCaptureDecisionSet = z.infer<typeof aiCaptureDecisionSetInputSchema>;
export type PrepareAiImportPlanInput = z.infer<typeof prepareAiImportPlanInputSchema>;
export type AiImportPlanStatus = z.infer<typeof aiImportPlanStatusSchema>;
export type AiWorkflowError = z.infer<typeof aiWorkflowErrorSchema>;
export type AiImportChangeCounts = z.infer<typeof aiImportChangeCountsSchema>;
export type AiImportPlan = z.infer<typeof aiImportPlanSchema>;
export type AiImportCommitResult = z.infer<typeof aiImportCommitResultSchema>;
export type AiImportBatchSummary = z.infer<typeof aiImportBatchSummarySchema>;
export type AiImportBatchListResponse = z.infer<typeof aiImportBatchListResponseSchema>;
export type AiImportBatchDetail = z.infer<typeof aiImportBatchDetailSchema>;
export type AiImportRecordType = z.infer<typeof aiImportRecordTypeSchema>;
export type AiImportRecordListResponse = z.infer<typeof aiImportRecordListResponseSchema>;
