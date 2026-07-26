import { z } from 'zod';

import { caseContentSchema, caseReferenceSchema, caseSummarySchema } from '../cases/caseSchemas.js';
import { eventNameSchema } from '../events/eventSchemas.js';
import {
  booleanQuerySchema,
  DETAIL_ASSOCIATION_PAGE_SIZE,
  pageListMetadataSchema,
  pageListQuerySchema,
} from '../pagination/pageSchemas.js';
import { searchModeSchema, semanticIndexNoticeSchema } from '../semantic/semanticSchemas.js';

const timestampSchema = z.iso.datetime({ offset: true });
const eventReferenceSchema = z.object({ id: z.uuid(), name: eventNameSchema }).strict();

export const relationFormInputSchema = z
  .object({
    causeEventId: z.uuid(),
    effectEventId: z.uuid(),
    confidence: z.number().int().min(0).max(100),
    description: z
      .string()
      .trim()
      .max(2_000)
      .nullable()
      .optional()
      .transform((value) => value || null),
    caseSelections: z
      .array(
        z.discriminatedUnion('type', [
          z.object({ type: z.literal('existing'), caseId: z.uuid() }).strict(),
          z.object({ type: z.literal('new'), content: caseContentSchema }).strict(),
        ]),
      )
      .max(1_000, '单条因果关系最多关联 1000 条具体案例')
      .default([]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.causeEventId === value.effectEventId) {
      context.addIssue({
        code: 'custom',
        message: '原因事件和结果事件不能相同',
        path: ['effectEventId'],
      });
    }
    const seen = new Set<string>();
    value.caseSelections.forEach((selection, index) => {
      const key =
        selection.type === 'existing' ? `existing:${selection.caseId}` : `new:${selection.content}`;
      if (seen.has(key)) {
        context.addIssue({
          code: 'custom',
          message: '同一关系不能重复选择案例',
          path: ['caseSelections', index],
        });
      }
      seen.add(key);
    });
  });

export const relationListQuerySchema = z
  .object({
    q: z.string().trim().max(120).default(''),
    orphan: booleanQuerySchema,
    eventId: z.uuid().optional(),
    searchMode: searchModeSchema,
    ...pageListQuerySchema.shape,
  })
  .strict();

export const relationPairCheckQuerySchema = z
  .object({
    causeEventId: z.uuid(),
    effectEventId: z.uuid(),
    excludeId: z.uuid().optional(),
  })
  .strict();

export const relationCaseListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(DETAIL_ASSOCIATION_PAGE_SIZE),
    cursor: z.string().min(1).max(2_000).optional(),
  })
  .strict();

export const relationReferenceSchema = z
  .object({
    id: z.uuid(),
    causeEvent: eventReferenceSchema,
    effectEvent: eventReferenceSchema,
  })
  .strict();

export const relationSummarySchema = relationReferenceSchema
  .extend({
    confidence: z.number().int().min(0).max(100),
    caseCount: z.number().int().nonnegative(),
    updatedAt: timestampSchema,
  })
  .strict();

export const relationDetailSchema = relationSummarySchema
  .extend({
    description: z.string().max(2_000).nullable(),
    listPage: z.number().int().min(1),
    createdAt: timestampSchema,
    recentCases: z.array(caseReferenceSchema).max(5),
  })
  .strict();

export const relationListResponseSchema = z
  .object({
    items: z.array(relationSummarySchema),
    ...pageListMetadataSchema.shape,
    semanticIndexNotice: semanticIndexNoticeSchema.default(null),
  })
  .strict();

export const relationPairCheckResponseSchema = z
  .object({
    sameDirection: relationReferenceSchema.nullable(),
    reverseDirection: relationReferenceSchema.nullable(),
  })
  .strict();

export const relationCaseListResponseSchema = z
  .object({
    items: z.array(caseSummarySchema.extend({ linkedAt: timestampSchema }).strict()),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  })
  .strict();

export type RelationFormInput = z.infer<typeof relationFormInputSchema>;
export type RelationListQuery = z.infer<typeof relationListQuerySchema>;
export type RelationPairCheckQuery = z.infer<typeof relationPairCheckQuerySchema>;
export type RelationCaseListQuery = z.infer<typeof relationCaseListQuerySchema>;
export type RelationReference = z.infer<typeof relationReferenceSchema>;
export type RelationSummary = z.infer<typeof relationSummarySchema>;
export type RelationDetail = z.infer<typeof relationDetailSchema>;
export type RelationListResponse = z.infer<typeof relationListResponseSchema>;
export type RelationPairCheckResponse = z.infer<typeof relationPairCheckResponseSchema>;
export type RelationCaseListResponse = z.infer<typeof relationCaseListResponseSchema>;
export type CaseSelection = RelationFormInput['caseSelections'][number];
