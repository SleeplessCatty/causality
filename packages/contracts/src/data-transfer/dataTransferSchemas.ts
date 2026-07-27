import { z } from 'zod';

import { caseContentSchema } from '../cases/caseSchemas.js';
import { eventNameSchema } from '../events/eventSchemas.js';
import { MAIN_LIST_PAGE_SIZE } from '../pagination/pageSchemas.js';

const timestampSchema = z.iso.datetime({ offset: true });
const fixedPageSizeSchema = z.literal(MAIN_LIST_PAGE_SIZE);
const nonnegativeCountSchema = z.number().int().nonnegative();

export const importRecordTypeSchema = z.enum(['event', 'case', 'relation', 'relation_case']);
export const importOutcomeSchema = z.enum(['created', 'reused']);
const importPageSchema = z.coerce.number().int().min(1).max(100_000).default(1);

export const importHistoryQuerySchema = z.object({ page: importPageSchema }).strict();
export const importDetailQuerySchema = z
  .object({
    type: importRecordTypeSchema.optional(),
    page: importPageSchema,
  })
  .strict();

export const importTypeCountsSchema = z
  .object({
    created: nonnegativeCountSchema,
    reused: nonnegativeCountSchema,
  })
  .strict();

export const importBatchSummarySchema = z
  .object({
    id: z.uuid(),
    filename: z.string().trim().min(1).max(255),
    completedAt: timestampSchema,
    recordTypes: z.array(importRecordTypeSchema).min(1),
    counts: z
      .object({
        event: importTypeCountsSchema,
        case: importTypeCountsSchema,
        relation: importTypeCountsSchema,
        relationCase: importTypeCountsSchema,
      })
      .strict(),
  })
  .strict();

export const importBatchListResponseSchema = z
  .object({
    items: z.array(importBatchSummarySchema),
    page: z.number().int().min(1),
    pageSize: fixedPageSizeSchema,
    totalItems: nonnegativeCountSchema,
    totalPages: z.number().int().min(1),
  })
  .strict();

export const importRecordTextSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('event'), eventName: eventNameSchema }).strict(),
  z.object({ type: z.literal('case'), caseContent: caseContentSchema }).strict(),
  z
    .object({
      type: z.literal('relation'),
      causeEventName: eventNameSchema,
      effectEventName: eventNameSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('relation_case'),
      causeEventName: eventNameSchema,
      effectEventName: eventNameSchema,
      caseContent: caseContentSchema,
    })
    .strict(),
]);

export const importRecordItemSchema = z
  .object({
    id: z.uuid(),
    sequence: z.number().int().positive(),
    outcome: importOutcomeSchema,
    text: importRecordTextSchema,
  })
  .strict();

export const importRecordListResponseSchema = z
  .object({
    items: z.array(importRecordItemSchema),
    page: z.number().int().min(1),
    pageSize: fixedPageSizeSchema,
    totalItems: nonnegativeCountSchema,
    totalPages: z.number().int().min(1),
  })
  .strict();

export const importUploadResponseSchema = z.object({ batch: importBatchSummarySchema }).strict();

export const MAX_EXPORT_START_EVENTS = 100;

export const exportDirectionSchema = z.enum(['upstream', 'downstream', 'both']);

export const exportPreparationInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('full') }).strict(),
  z
    .object({
      type: z.literal('filtered'),
      startEventIds: z.array(z.uuid()).min(1).max(MAX_EXPORT_START_EVENTS),
      direction: exportDirectionSchema,
      depth: z.number().int().min(1).max(10),
    })
    .strict(),
]);

export const exportCountsSchema = z
  .object({
    events: nonnegativeCountSchema,
    cases: nonnegativeCountSchema,
    relations: nonnegativeCountSchema,
  })
  .strict();

export const exportPreparationResponseSchema = z
  .object({
    token: z.string().min(1).max(512),
    expiresAt: timestampSchema,
    counts: exportCountsSchema,
  })
  .strict();

export const exportAvailabilityResponseSchema = z
  .object({
    available: z.literal(true),
    expiresAt: timestampSchema,
  })
  .strict();

export type ImportRecordType = z.infer<typeof importRecordTypeSchema>;
export type ImportOutcome = z.infer<typeof importOutcomeSchema>;
export type ImportHistoryQuery = z.infer<typeof importHistoryQuerySchema>;
export type ImportDetailQuery = z.infer<typeof importDetailQuerySchema>;
export type ImportTypeCounts = z.infer<typeof importTypeCountsSchema>;
export type ImportBatchSummary = z.infer<typeof importBatchSummarySchema>;
export type ImportBatchListResponse = z.infer<typeof importBatchListResponseSchema>;
export type ImportRecordText = z.infer<typeof importRecordTextSchema>;
export type ImportRecordItem = z.infer<typeof importRecordItemSchema>;
export type ImportRecordListResponse = z.infer<typeof importRecordListResponseSchema>;
export type ImportUploadResponse = z.infer<typeof importUploadResponseSchema>;
export type ExportDirection = z.infer<typeof exportDirectionSchema>;
export type ExportPreparationInput = z.infer<typeof exportPreparationInputSchema>;
export type ExportCounts = z.infer<typeof exportCountsSchema>;
export type ExportPreparationResponse = z.infer<typeof exportPreparationResponseSchema>;
export type ExportAvailabilityResponse = z.infer<typeof exportAvailabilityResponseSchema>;
