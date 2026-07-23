import { z } from 'zod';

const timestampSchema = z.iso.datetime({ offset: true });

export const searchModeSchema = z.enum(['standard', 'enhanced']).default('standard');
export const semanticModelCodeSchema = z.enum(['multilingual-e5-small', 'bge-m3']);
export const semanticEntityTypeSchema = z.enum(['event', 'relation', 'case']);
export const semanticTaskTypeSchema = z.enum(['download', 'full_index', 'incremental']);
export const semanticTaskStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed']);
export const semanticDownloadStatusSchema = z.enum([
  'not_downloaded',
  'downloading',
  'verifying',
  'downloaded',
  'failed',
]);
export const semanticIndexStatusSchema = z.enum([
  'empty',
  'waiting_model',
  'loading',
  'building',
  'updating',
  'ready',
  'failed',
]);

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
    type: semanticTaskTypeSchema,
    status: semanticTaskStatusSchema,
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

export const semanticUseModelResponseSchema = z
  .object({
    accepted: z.literal(true),
    taskId: z.uuid(),
    activeModelCode: semanticModelCodeSchema,
  })
  .strict();

export type SearchMode = z.infer<typeof searchModeSchema>;
export type SemanticModelCode = z.infer<typeof semanticModelCodeSchema>;
export type SemanticEntityType = z.infer<typeof semanticEntityTypeSchema>;
export type SemanticTaskType = z.infer<typeof semanticTaskTypeSchema>;
export type SemanticTaskStatus = z.infer<typeof semanticTaskStatusSchema>;
export type SemanticDownloadStatus = z.infer<typeof semanticDownloadStatusSchema>;
export type SemanticIndexStatus = z.infer<typeof semanticIndexStatusSchema>;
export type SemanticThresholdInput = z.infer<typeof semanticThresholdInputSchema>;
export type SemanticModel = z.infer<typeof semanticModelSchema>;
export type SemanticIndex = z.infer<typeof semanticIndexSchema>;
export type SemanticTask = z.infer<typeof semanticTaskSchema>;
export type SemanticSettingsResponse = z.infer<typeof semanticSettingsResponseSchema>;
export type SemanticUseModelResponse = z.infer<typeof semanticUseModelResponseSchema>;
