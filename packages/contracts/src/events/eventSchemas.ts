import { z } from 'zod';

import {
  DETAIL_ASSOCIATION_PAGE_SIZE,
  pageListMetadataSchema,
  pageListQuerySchema,
} from '../pagination/pageSchemas.js';

export const eventNameSchema = z.string().trim().min(1).max(50);
export const eventAliasSchema = z.string().trim().min(1).max(80);
export const eventKeywordSchema = z.string().trim().min(1).max(50);
const timestampSchema = z.iso.datetime({ offset: true });

function addDuplicateIssues(
  values: string[],
  path: 'aliases' | 'keywords',
  context: z.core.$RefinementCtx,
): void {
  const seen = new Set<string>();

  values.forEach((value, index) => {
    const normalized = value.toLocaleLowerCase();
    if (seen.has(normalized)) {
      context.addIssue({
        code: 'custom',
        message: path === 'aliases' ? '同一事件不能有重复别名' : '同一事件不能有重复关键词',
        path: [path, index],
      });
    }
    seen.add(normalized);
  });
}

export const eventFormInputSchema = z
  .object({
    name: eventNameSchema,
    description: z
      .string()
      .trim()
      .max(2_000)
      .nullable()
      .optional()
      .transform((value) => value || null),
    aliases: z.array(eventAliasSchema).max(20).default([]),
    keywords: z.array(eventKeywordSchema).max(20).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    addDuplicateIssues(value.aliases, 'aliases', context);
    addDuplicateIssues(value.keywords, 'keywords', context);
  });

export const eventListQuerySchema = z
  .object({
    q: z.string().trim().max(80).default(''),
    ...pageListQuerySchema.shape,
  })
  .strict();

export const eventCandidateQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(80),
    limit: z.coerce.number().int().min(1).max(100).default(100),
    cursor: z.string().min(1).max(2_000).optional(),
    excludeId: z.uuid().optional(),
  })
  .strict();

export const eventCandidateSchema = z
  .object({
    id: z.uuid(),
    name: eventNameSchema,
  })
  .strict();

export const eventRelationListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(DETAIL_ASSOCIATION_PAGE_SIZE),
    cursor: z.string().min(1).max(2_000).optional(),
  })
  .strict();

const eventRelationSummarySchema = z
  .object({
    id: z.uuid(),
    causeEvent: eventCandidateSchema,
    effectEvent: eventCandidateSchema,
    linkedAt: timestampSchema,
  })
  .strict();

export const eventSummarySchema = z
  .object({
    id: z.uuid(),
    name: eventNameSchema,
    aliases: z.array(eventAliasSchema),
    keywords: z.array(eventKeywordSchema),
    updatedAt: timestampSchema,
  })
  .strict();

export const eventDetailSchema = eventSummarySchema
  .omit({ updatedAt: true })
  .extend({
    description: z.string().max(2_000).nullable(),
    relationCount: z.number().int().nonnegative(),
    listPage: z.number().int().min(1),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export const eventListResponseSchema = z
  .object({
    items: z.array(eventSummarySchema),
    ...pageListMetadataSchema.shape,
  })
  .strict();

export const eventCandidateListResponseSchema = z
  .object({
    items: z.array(eventCandidateSchema),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  })
  .strict();

export const eventRelationListResponseSchema = z
  .object({
    items: z.array(eventRelationSummarySchema),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  })
  .strict();

export const apiErrorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'EVENT_NOT_FOUND',
  'EVENT_NAME_CONFLICT',
  'EVENT_ALIAS_CONFLICT',
  'RELATION_NOT_FOUND',
  'RELATION_EVENT_NOT_FOUND',
  'RELATION_SELF_LOOP',
  'RELATION_DIRECTION_CONFLICT',
  'CASE_NOT_FOUND',
  'CASE_CONTENT_CONFLICT',
  'CASE_SELECTION_DUPLICATE',
  'INTERNAL_ERROR',
]);

export const apiErrorSchema = z
  .object({
    code: apiErrorCodeSchema,
    message: z.string().min(1),
    fields: z.record(z.string(), z.string()).optional(),
    existingId: z.uuid().optional(),
  })
  .strict();

export type EventFormInput = z.infer<typeof eventFormInputSchema>;
export type EventListQuery = z.infer<typeof eventListQuerySchema>;
export type EventCandidateQuery = z.infer<typeof eventCandidateQuerySchema>;
export type EventCandidate = z.infer<typeof eventCandidateSchema>;
export type EventRelationListQuery = z.infer<typeof eventRelationListQuerySchema>;
export type EventRelationSummary = z.infer<typeof eventRelationSummarySchema>;
export type EventRelationListResponse = z.infer<typeof eventRelationListResponseSchema>;
export type EventSummary = z.infer<typeof eventSummarySchema>;
export type EventDetail = z.infer<typeof eventDetailSchema>;
export type EventListResponse = z.infer<typeof eventListResponseSchema>;
export type EventCandidateListResponse = z.infer<typeof eventCandidateListResponseSchema>;
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
