import { z } from 'zod';

const timestampSchema = z.iso.datetime({ offset: true });
import { eventNameSchema } from '../events/eventSchemas.js';

const eventReferenceSchema = z.object({ id: z.uuid(), name: eventNameSchema }).strict();

export const caseContentSchema = z.string().trim().min(1).max(100);

export const caseFormInputSchema = z.object({ content: caseContentSchema }).strict();

export const caseListQuerySchema = z
  .object({
    q: z.string().trim().max(100).default(''),
    relationId: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
    cursor: z.string().min(1).max(2_000).optional(),
  })
  .strict();

export const caseCandidateQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(100),
    limit: z.coerce.number().int().min(1).max(100).default(100),
    cursor: z.string().min(1).max(2_000).optional(),
  })
  .strict();

export const caseRelationListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(30),
    cursor: z.string().min(1).max(2_000).optional(),
  })
  .strict();

export const caseReferenceSchema = z.object({ id: z.uuid(), content: caseContentSchema }).strict();

export const caseSummarySchema = caseReferenceSchema
  .extend({
    relationCount: z.number().int().nonnegative(),
    updatedAt: timestampSchema,
  })
  .strict();

export const caseDetailSchema = caseSummarySchema.extend({ createdAt: timestampSchema }).strict();

export const caseListResponseSchema = z
  .object({
    items: z.array(caseSummarySchema),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  })
  .strict();

export const caseCandidateListResponseSchema = z
  .object({
    items: z.array(caseReferenceSchema),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  })
  .strict();

export const caseRelationSummarySchema = z
  .object({
    id: z.uuid(),
    causeEvent: eventReferenceSchema,
    effectEvent: eventReferenceSchema,
    linkedAt: timestampSchema,
  })
  .strict();

export const caseRelationListResponseSchema = z
  .object({
    items: z.array(caseRelationSummarySchema),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  })
  .strict();

export type CaseFormInput = z.infer<typeof caseFormInputSchema>;
export type CaseListQuery = z.infer<typeof caseListQuerySchema>;
export type CaseCandidateQuery = z.infer<typeof caseCandidateQuerySchema>;
export type CaseRelationListQuery = z.infer<typeof caseRelationListQuerySchema>;
export type CaseReference = z.infer<typeof caseReferenceSchema>;
export type CaseSummary = z.infer<typeof caseSummarySchema>;
export type CaseDetail = z.infer<typeof caseDetailSchema>;
export type CaseListResponse = z.infer<typeof caseListResponseSchema>;
export type CaseCandidateListResponse = z.infer<typeof caseCandidateListResponseSchema>;
export type CaseRelationSummary = z.infer<typeof caseRelationSummarySchema>;
export type CaseRelationListResponse = z.infer<typeof caseRelationListResponseSchema>;
