import { z } from 'zod';

const timestampSchema = z.iso.datetime({ offset: true });
const nullableTimestampSchema = timestampSchema.nullable();
const fixedIssuePageSizeSchema = z.literal(50);

export const dataCheckRunStatusSchema = z.enum(['never_run', 'running', 'succeeded', 'failed']);
export const dataCheckSeveritySchema = z.enum(['error', 'warning']);
export const dataCheckActionModeSchema = z.enum(['auto', 'manual']);
export const dataCheckIssueStatusSchema = z.enum(['open', 'handled']);
export const dataCheckSemanticStatusSchema = z.enum([
  'completed',
  'skipped',
  'failed',
  'truncated',
]);
export const dataCheckSemanticReasonSchema = z
  .enum([
    'not_recorded',
    'no_active_model',
    'worker_unreachable',
    'index_not_ready',
    'no_embeddings',
    'candidate_limit',
    'internal_failure',
  ])
  .nullable();
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
    semanticStatus: dataCheckSemanticStatusSchema,
    semanticReason: dataCheckSemanticReasonSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const valid =
      (value.semanticStatus === 'completed' && value.semanticReason === null) ||
      (value.semanticStatus === 'truncated' && value.semanticReason === 'candidate_limit') ||
      (value.semanticStatus === 'failed' && value.semanticReason === 'internal_failure') ||
      (value.semanticStatus === 'skipped' &&
        value.semanticReason !== null &&
        [
          'not_recorded',
          'no_active_model',
          'worker_unreachable',
          'index_not_ready',
          'no_embeddings',
        ].includes(value.semanticReason));

    if (!valid) {
      context.addIssue({
        code: 'custom',
        path: ['semanticReason'],
        message: '语义检查状态与原因不匹配',
      });
    }
  });

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

const mergeActionRequestSchema = z
  .object({
    type: z.literal('merge'),
    snapshotId: z.uuid(),
    keepId: z.uuid(),
    mergeId: z.uuid(),
  })
  .strict()
  .refine((value) => value.keepId !== value.mergeId, {
    path: ['mergeId'],
    message: '合并记录必须是不同记录',
  });

export const dataCheckActionRequestSchema = z.discriminatedUnion('type', [
  mergeActionRequestSchema,
  z.object({ type: z.literal('cleanup'), snapshotId: z.uuid() }).strict(),
  z.object({ type: z.literal('delete_relation'), snapshotId: z.uuid() }).strict(),
  z.object({ type: z.literal('repair_timestamp'), snapshotId: z.uuid() }).strict(),
  z.object({ type: z.literal('ignore'), snapshotId: z.uuid() }).strict(),
]);

export const dataCheckDialogKindSchema = z.enum([
  'merge',
  'cleanup',
  'delete_relation',
  'repair_timestamp',
  'edit',
  'ignore_only',
]);
export const dataCheckAllowedActionSchema = z.enum([
  'merge',
  'cleanup',
  'delete_relation',
  'repair_timestamp',
  'ignore',
  'open_edit',
]);

export const dataCheckActionRecordSchema = z
  .object({
    id: z.string().trim().min(1).max(100),
    targetType: dataCheckTargetTypeSchema,
    title: z.string().trim().min(1).max(100),
    primaryText: z.string().max(4_000),
    secondaryText: z.array(z.string().max(4_000)).max(20),
    detailPath: z.string().trim().min(1).max(300).nullable(),
    relationCount: z.number().int().nonnegative(),
    caseCount: z.number().int().nonnegative(),
  })
  .strict();

export const dataCheckActionImpactSchema = z
  .object({
    relationsMoved: z.number().int().nonnegative(),
    relationsDeleted: z.number().int().nonnegative(),
    relationCaseLinksMoved: z.number().int().nonnegative(),
    relationCaseLinksDeleted: z.number().int().nonnegative(),
    recordsDeleted: z.number().int().nonnegative(),
  })
  .strict();

export const dataCheckActionOptionSchema = z
  .object({
    type: dataCheckAllowedActionSchema,
    label: z.string().trim().min(1).max(100),
    keepId: z.uuid().nullable(),
    mergeId: z.uuid().nullable(),
    editPath: z.string().trim().min(1).max(300).nullable(),
    impact: dataCheckActionImpactSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.type === 'merge') {
      if (!value.keepId || !value.mergeId || value.keepId === value.mergeId) {
        context.addIssue({
          code: 'custom',
          path: ['keepId'],
          message: '合并操作必须指定两个不同记录',
        });
      }
      if (value.editPath !== null) {
        context.addIssue({ code: 'custom', path: ['editPath'], message: '合并操作不能打开编辑页' });
      }
      return;
    }
    if (value.keepId !== null || value.mergeId !== null) {
      context.addIssue({ code: 'custom', path: ['keepId'], message: '非合并操作不能指定记录对' });
    }
    if ((value.type === 'open_edit') !== (value.editPath !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['editPath'],
        message: '编辑操作必须且只能指定编辑路径',
      });
    }
  });

export const dataCheckActionContextSchema = z
  .object({
    snapshotId: z.uuid(),
    issueId: z.uuid(),
    issueType: z.string().trim().min(1).max(80),
    status: dataCheckIssueStatusSchema,
    dialogKind: dataCheckDialogKindSchema,
    records: z.array(dataCheckActionRecordSchema).max(2),
    actions: z.array(dataCheckActionOptionSchema).max(10),
    message: z.string().trim().min(1).max(300).nullable(),
  })
  .strict();

export const dataCheckActionResponseSchema = z
  .object({
    issue: dataCheckIssueSchema,
    affectedEventIds: z.array(z.uuid()),
    affectedCaseIds: z.array(z.uuid()),
    affectedRelationIds: z.array(z.uuid()),
  })
  .strict();

export const dataCheckRecheckResponseSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('resolved'),
      issue: dataCheckIssueSchema,
      context: z.null(),
    })
    .strict(),
  z
    .object({
      status: z.literal('open'),
      issue: dataCheckIssueSchema,
      context: dataCheckActionContextSchema,
    })
    .strict(),
]);

export type DataCheckRunStatus = z.infer<typeof dataCheckRunStatusSchema>;
export type DataCheckSeverity = z.infer<typeof dataCheckSeveritySchema>;
export type DataCheckActionMode = z.infer<typeof dataCheckActionModeSchema>;
export type DataCheckIssueStatus = z.infer<typeof dataCheckIssueStatusSchema>;
export type DataCheckSemanticStatus = z.infer<typeof dataCheckSemanticStatusSchema>;
export type DataCheckSemanticReason = z.infer<typeof dataCheckSemanticReasonSchema>;
export type DataCheckTargetType = z.infer<typeof dataCheckTargetTypeSchema>;
export type DataCheckTask = z.infer<typeof dataCheckTaskSchema>;
export type DataCheckSnapshotSummary = z.infer<typeof dataCheckSnapshotSummarySchema>;
export type DataCheckFailure = z.infer<typeof dataCheckFailureSchema>;
export type DataCheckLatestResponse = z.infer<typeof dataCheckLatestResponseSchema>;
export type DataCheckIssue = z.infer<typeof dataCheckIssueSchema>;
export type DataCheckIssueListQuery = z.infer<typeof dataCheckIssueListQuerySchema>;
export type DataCheckIssueListResponse = z.infer<typeof dataCheckIssueListResponseSchema>;
export type DataCheckHandlingRequest = z.infer<typeof dataCheckHandlingRequestSchema>;
export type DataCheckActionRequest = z.infer<typeof dataCheckActionRequestSchema>;
export type DataCheckDialogKind = z.infer<typeof dataCheckDialogKindSchema>;
export type DataCheckAllowedAction = z.infer<typeof dataCheckAllowedActionSchema>;
export type DataCheckActionRecord = z.infer<typeof dataCheckActionRecordSchema>;
export type DataCheckActionImpact = z.infer<typeof dataCheckActionImpactSchema>;
export type DataCheckActionOption = z.infer<typeof dataCheckActionOptionSchema>;
export type DataCheckActionContext = z.infer<typeof dataCheckActionContextSchema>;
export type DataCheckActionResponse = z.infer<typeof dataCheckActionResponseSchema>;
export type DataCheckRecheckResponse = z.infer<typeof dataCheckRecheckResponseSchema>;
