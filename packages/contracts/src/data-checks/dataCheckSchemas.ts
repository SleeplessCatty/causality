import { z } from 'zod';

const timestampSchema = z.iso.datetime({ offset: true });
const nullableTimestampSchema = timestampSchema.nullable();
const fixedIssuePageSizeSchema = z.literal(50);

export const dataCheckRunStatusSchema = z.enum(['never_run', 'running', 'succeeded', 'failed']);
export const dataCheckSeveritySchema = z.enum(['error', 'warning']);
export const dataCheckActionModeSchema = z.enum(['auto', 'manual']);
export const dataCheckIssueStatusSchema = z.enum(['open', 'handled']);
export const dataCheckTargetTypeSchema = z.enum([
  'event',
  'relation',
  'case',
  'alias',
  'keyword',
  'relation_case',
]);

export const dataCheckTaskSchema = z
  .object({
    status: dataCheckRunStatusSchema,
    startedAt: nullableTimestampSchema,
    finishedAt: nullableTimestampSchema,
  })
  .strict();

export const dataCheckSnapshotSummarySchema = z
  .object({
    snapshotId: z.uuid(),
    checkedAt: timestampSchema,
    orphanEventCount: z.number().int().nonnegative(),
    orphanRelationCount: z.number().int().nonnegative(),
    orphanCaseCount: z.number().int().nonnegative(),
    errorCount: z.number().int().nonnegative(),
    warningCount: z.number().int().nonnegative(),
    openCount: z.number().int().nonnegative(),
    handledCount: z.number().int().nonnegative(),
  })
  .strict();

export const dataCheckFailureSchema = z
  .object({
    failedAt: timestampSchema,
    message: z.string().trim().min(1).max(500),
  })
  .strict();

export const dataCheckLatestResponseSchema = z
  .object({
    task: dataCheckTaskSchema,
    snapshot: dataCheckSnapshotSummarySchema.nullable(),
    latestFailure: dataCheckFailureSchema.nullable(),
  })
  .strict();

export const dataCheckIssueSchema = z
  .object({
    id: z.uuid(),
    snapshotId: z.uuid(),
    severity: dataCheckSeveritySchema,
    issueType: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(300),
    suggestion: z.string().trim().min(1).max(300),
    actionMode: dataCheckActionModeSchema,
    status: dataCheckIssueStatusSchema,
    targetType: dataCheckTargetTypeSchema,
    targetId: z.string().trim().min(1).max(100),
    relatedId: z.string().trim().min(1).max(100).nullable(),
    handledAt: nullableTimestampSchema,
  })
  .strict();

export const dataCheckIssueListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    severity: dataCheckSeveritySchema.optional(),
    issueType: z.string().trim().min(1).max(80).optional(),
    status: dataCheckIssueStatusSchema.optional(),
  })
  .strict();

export const dataCheckIssueListResponseSchema = z
  .object({
    items: z.array(dataCheckIssueSchema),
    page: z.number().int().min(1),
    pageSize: fixedIssuePageSizeSchema,
    totalItems: z.number().int().nonnegative(),
    totalPages: z.number().int().min(1),
  })
  .strict();

export const dataCheckHandlingRequestSchema = z.object({ snapshotId: z.uuid() }).strict();

export type DataCheckRunStatus = z.infer<typeof dataCheckRunStatusSchema>;
export type DataCheckSeverity = z.infer<typeof dataCheckSeveritySchema>;
export type DataCheckActionMode = z.infer<typeof dataCheckActionModeSchema>;
export type DataCheckIssueStatus = z.infer<typeof dataCheckIssueStatusSchema>;
export type DataCheckTargetType = z.infer<typeof dataCheckTargetTypeSchema>;
export type DataCheckTask = z.infer<typeof dataCheckTaskSchema>;
export type DataCheckSnapshotSummary = z.infer<typeof dataCheckSnapshotSummarySchema>;
export type DataCheckFailure = z.infer<typeof dataCheckFailureSchema>;
export type DataCheckLatestResponse = z.infer<typeof dataCheckLatestResponseSchema>;
export type DataCheckIssue = z.infer<typeof dataCheckIssueSchema>;
export type DataCheckIssueListQuery = z.infer<typeof dataCheckIssueListQuerySchema>;
export type DataCheckIssueListResponse = z.infer<typeof dataCheckIssueListResponseSchema>;
export type DataCheckHandlingRequest = z.infer<typeof dataCheckHandlingRequestSchema>;
