import { z } from 'zod';

const timestampSchema = z.iso.datetime({ offset: true });
const eventReferenceSchema = z
  .object({ id: z.uuid(), name: z.string().trim().min(1).max(120) })
  .strict();

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
  });

export const relationListQuerySchema = z
  .object({
    q: z.string().trim().max(120).default(''),
    limit: z.coerce.number().int().min(1).max(100).default(30),
    cursor: z.string().min(1).max(2_000).optional(),
  })
  .strict();

export const relationPairCheckQuerySchema = z
  .object({
    causeEventId: z.uuid(),
    effectEventId: z.uuid(),
    excludeId: z.uuid().optional(),
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
    caseCount: z.literal(0),
    updatedAt: timestampSchema,
  })
  .strict();

export const relationDetailSchema = relationSummarySchema
  .extend({
    description: z.string().max(2_000).nullable(),
    createdAt: timestampSchema,
  })
  .strict();

export const relationListResponseSchema = z
  .object({
    items: z.array(relationSummarySchema),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  })
  .strict();

export const relationPairCheckResponseSchema = z
  .object({
    sameDirection: relationReferenceSchema.nullable(),
    reverseDirection: relationReferenceSchema.nullable(),
  })
  .strict();

export type RelationFormInput = z.infer<typeof relationFormInputSchema>;
export type RelationListQuery = z.infer<typeof relationListQuerySchema>;
export type RelationPairCheckQuery = z.infer<typeof relationPairCheckQuerySchema>;
export type RelationReference = z.infer<typeof relationReferenceSchema>;
export type RelationSummary = z.infer<typeof relationSummarySchema>;
export type RelationDetail = z.infer<typeof relationDetailSchema>;
export type RelationListResponse = z.infer<typeof relationListResponseSchema>;
export type RelationPairCheckResponse = z.infer<typeof relationPairCheckResponseSchema>;
