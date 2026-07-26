import { z } from 'zod';

const timestampSchema = z.iso.datetime({ offset: true });

export const searchModeSchema = z.enum(['standard', 'enhanced']).default('standard');
export const semanticModelCodeSchema = z.enum([
  'bge-small-zh-v1.5',
  'multilingual-e5-small',
  'granite-embedding-97m-multilingual-r2',
  'bge-m3',
]);
export const semanticModelParamsSchema = z
  .object({
    modelCode: semanticModelCodeSchema,
  })
  .strict();
export const semanticEntityTypeSchema = z.enum(['event', 'relation', 'case']);
/** @deprecated Used only by the legacy settings response until Task 9. */
export const legacySemanticTaskTypeSchema = z.enum(['download', 'full_index', 'incremental']);
/** @deprecated Used only by the legacy settings response until Task 9. */
export const legacySemanticTaskStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed']);
export const semanticTaskTypeSchema = z.enum(['download', 'load', 'full_index', 'incremental']);
export const semanticTaskStatusSchema = z.enum(['queued', 'running', 'retry_wait', 'failed']);
export const semanticTaskPhaseSchema = z.enum([
  'waiting',
  'downloading',
  'verifying',
  'loading',
  'indexing',
]);
export const semanticDownloadStatusSchema = z.enum([
  'not_downloaded',
  'downloading',
  'verifying',
  'downloaded',
  'failed',
]);
export const semanticModelFileStatusSchema = z.enum([
  'not_downloaded',
  'download_queued',
  'downloading',
  'verifying',
  'downloaded',
  'invalid',
  'failed',
]);
export const semanticIndexStatusSchema = z.enum([
  'empty',
  'waiting_model',
  'loading',
  'index_queued',
  'building',
  'ready',
  'updating',
  'incomplete',
  'failed',
]);
export const semanticFailureStageSchema = z.enum([
  'download',
  'verify',
  'load',
  'full_index',
  'incremental',
]);
export const semanticFailureKindSchema = z.enum(['retryable', 'manual']);
export const semanticModelRoleSchema = z.enum(['inactive', 'current']);
export const semanticModelStageSchema = z.enum([
  'not_downloaded',
  'download_queued',
  'downloading',
  'verifying',
  'downloaded',
  'invalid',
  'loading',
  'index_queued',
  'building',
  'ready',
  'updating',
  'incomplete',
  'failed',
]);
export const semanticActionSchema = z.enum([
  'download_and_use',
  'use',
  'retry_download',
  'redownload_and_use',
  'retry_load',
  'retry_full_index',
  'reindex',
]);
export const semanticIndexNoticeSchema = z.enum(['updating', 'incomplete']).nullable();

export const semanticFailureSchema = z
  .object({
    stage: semanticFailureStageSchema,
    kind: semanticFailureKindSchema,
    code: z.string().trim().min(1),
    message: z.string().trim().min(1),
    attempts: z.number().int().nonnegative(),
    occurredAt: timestampSchema,
  })
  .strict();

export const semanticProgressSchema = z.discriminatedUnion('unit', [
  z
    .object({
      unit: z.literal('bytes'),
      completed: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      unit: z.literal('items'),
      completed: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
    })
    .strict(),
]);

export const semanticOperationSchema = z
  .object({
    type: z.enum(['download', 'load', 'full_index']),
    phase: semanticTaskPhaseSchema,
    status: semanticTaskStatusSchema,
    modelCode: semanticModelCodeSchema,
    attempt: z.number().int().nonnegative().max(3),
    maxAttempts: z.literal(3),
    progress: semanticProgressSchema.nullable(),
    nextRetryAt: timestampSchema.nullable(),
    failure: semanticFailureSchema.nullable(),
  })
  .strict();

export const semanticWorkerStatusSchema = z
  .object({
    status: z.enum(['online', 'unreachable']),
    modelState: z.enum(['idle', 'preparing', 'loaded', 'missing', 'mismatch']),
    loadedModelCode: semanticModelCodeSchema.nullable(),
    checkedAt: timestampSchema,
  })
  .strict();

export const semanticIndexLifecycleSchema = z
  .object({
    status: semanticIndexStatusSchema,
    processedItems: z.number().int().nonnegative(),
    totalItems: z.number().int().nonnegative(),
    pendingItems: z.number().int().nonnegative(),
    failedItems: z.number().int().nonnegative(),
    availableForEnhancedSearch: z.boolean(),
    failure: semanticFailureSchema.nullable(),
    updatedAt: timestampSchema.nullable(),
  })
  .strict();

export const semanticModelLifecycleSchema = z
  .object({
    modelCode: semanticModelCodeSchema,
    label: z.string().min(1),
    description: z.string().min(1),
    languageLabel: z.string().min(1),
    dimensions: z.number().int().positive(),
    expectedDownloadBytes: z.number().int().nonnegative(),
    threshold: z.number().int().min(0).max(100),
    downloadedAt: timestampSchema.nullable(),
    fileState: semanticModelFileStatusSchema,
    role: semanticModelRoleSchema,
    stage: semanticModelStageSchema,
    availableForEnhancedSearch: z.boolean(),
    allowedActions: z.array(semanticActionSchema),
    failure: semanticFailureSchema.nullable(),
  })
  .strict();

export const semanticPollAfterMsSchema = z.union([z.literal(1_000), z.literal(5_000), z.null()]);

export const semanticLifecycleSnapshotSchema = z
  .object({
    currentModelCode: semanticModelCodeSchema.nullable(),
    models: z.array(semanticModelLifecycleSchema),
    index: semanticIndexLifecycleSchema,
    operation: semanticOperationSchema.nullable(),
    worker: semanticWorkerStatusSchema,
    pollAfterMs: semanticPollAfterMsSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export const semanticThresholdInputSchema = z
  .object({
    threshold: z.number().int().min(0).max(100),
  })
  .strict();

export const semanticModelSchema = z
  .object({
    code: semanticModelCodeSchema,
    label: z.string().min(1),
    description: z.string().min(1),
    languageLabel: z.string().min(1),
    dimensions: z.number().int().positive(),
    expectedDownloadBytes: z.number().int().nonnegative(),
    threshold: z.number().int().min(0).max(100),
    downloadStatus: semanticDownloadStatusSchema,
    downloadedAt: timestampSchema.nullable(),
    isActive: z.boolean(),
    error: z.string().min(1).nullable(),
  })
  .strict();

export const semanticIndexSchema = z
  .object({
    status: semanticIndexStatusSchema,
    processedItems: z.number().int().nonnegative(),
    totalItems: z.number().int().nonnegative(),
    pendingItems: z.number().int().nonnegative(),
    updatedAt: timestampSchema.nullable(),
    error: z.string().min(1).nullable(),
  })
  .strict();

export const semanticTaskSchema = z
  .object({
    id: z.uuid(),
    type: legacySemanticTaskTypeSchema,
    status: legacySemanticTaskStatusSchema,
    modelCode: semanticModelCodeSchema,
    processedItems: z.number().int().nonnegative(),
    totalItems: z.number().int().nonnegative(),
    downloadedBytes: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
    createdAt: timestampSchema,
    startedAt: timestampSchema.nullable(),
    updatedAt: timestampSchema,
    completedAt: timestampSchema.nullable(),
    error: z.string().min(1).nullable(),
  })
  .strict();

export const semanticSettingsResponseSchema = z
  .object({
    activeModelCode: semanticModelCodeSchema.nullable(),
    index: semanticIndexSchema,
    models: z.array(semanticModelSchema),
    activeTask: semanticTaskSchema.nullable(),
  })
  .strict();

export const semanticActionAcceptedSchema = z
  .object({
    accepted: z.literal(true),
    taskId: z.uuid(),
    activeModelCode: semanticModelCodeSchema,
  })
  .strict();
/** @deprecated Use semanticActionAcceptedSchema. */
export const semanticUseModelResponseSchema = semanticActionAcceptedSchema;

export type SearchMode = z.infer<typeof searchModeSchema>;
export type SemanticModelCode = z.infer<typeof semanticModelCodeSchema>;
export type SemanticModelParams = z.infer<typeof semanticModelParamsSchema>;
export type SemanticEntityType = z.infer<typeof semanticEntityTypeSchema>;
export type SemanticTaskType = z.infer<typeof semanticTaskTypeSchema>;
export type SemanticTaskStatus = z.infer<typeof semanticTaskStatusSchema>;
export type LegacySemanticTaskType = z.infer<typeof legacySemanticTaskTypeSchema>;
export type LegacySemanticTaskStatus = z.infer<typeof legacySemanticTaskStatusSchema>;
export type SemanticTaskPhase = z.infer<typeof semanticTaskPhaseSchema>;
export type SemanticDownloadStatus = z.infer<typeof semanticDownloadStatusSchema>;
export type SemanticModelFileStatus = z.infer<typeof semanticModelFileStatusSchema>;
export type SemanticIndexStatus = z.infer<typeof semanticIndexStatusSchema>;
export type SemanticFailureStage = z.infer<typeof semanticFailureStageSchema>;
export type SemanticFailureKind = z.infer<typeof semanticFailureKindSchema>;
export type SemanticFailure = z.infer<typeof semanticFailureSchema>;
export type SemanticModelRole = z.infer<typeof semanticModelRoleSchema>;
export type SemanticModelStage = z.infer<typeof semanticModelStageSchema>;
export type SemanticAction = z.infer<typeof semanticActionSchema>;
export type SemanticIndexNotice = z.infer<typeof semanticIndexNoticeSchema>;
export type SemanticProgress = z.infer<typeof semanticProgressSchema>;
export type SemanticOperation = z.infer<typeof semanticOperationSchema>;
export type SemanticWorkerStatus = z.infer<typeof semanticWorkerStatusSchema>;
export type SemanticIndexLifecycle = z.infer<typeof semanticIndexLifecycleSchema>;
export type SemanticModelLifecycle = z.infer<typeof semanticModelLifecycleSchema>;
export type SemanticPollAfterMs = z.infer<typeof semanticPollAfterMsSchema>;
export type SemanticLifecycleSnapshot = z.infer<typeof semanticLifecycleSnapshotSchema>;
export type SemanticThresholdInput = z.infer<typeof semanticThresholdInputSchema>;
export type SemanticModel = z.infer<typeof semanticModelSchema>;
export type SemanticIndex = z.infer<typeof semanticIndexSchema>;
export type SemanticTask = z.infer<typeof semanticTaskSchema>;
export type SemanticSettingsResponse = z.infer<typeof semanticSettingsResponseSchema>;
export type SemanticActionAccepted = z.infer<typeof semanticActionAcceptedSchema>;
/** @deprecated Use SemanticActionAccepted. */
export type SemanticUseModelResponse = z.infer<typeof semanticUseModelResponseSchema>;
