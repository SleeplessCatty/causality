import { z } from 'zod';

import {
  semanticIndexStatusSchema,
  semanticModelCodeSchema,
  semanticModelFileStatusSchema,
} from '@causality/contracts';

export const capabilityManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    server: z
      .object({
        name: z.literal('causality'),
        version: z.string().min(1),
      })
      .strict(),
    tools: z
      .array(
        z
          .object({
            name: z.string().min(1),
            purpose: z.string().min(1),
            access: z.enum(['read_only', 'controlled_write']),
          })
          .strict(),
      )
      .length(15),
    prompts: z
      .array(z.object({ name: z.string().min(1), purpose: z.string().min(1) }).strict())
      .length(4),
    resources: z
      .array(
        z
          .object({ uri: z.string().startsWith('causality://'), purpose: z.string().min(1) })
          .strict(),
      )
      .length(4),
    limits: z
      .object({
        eventAnalysisInspectedRelations: z.literal(100),
        eventAnalysisDisplayedRelations: z.literal(5),
        casesPerDisplayedRelation: z.literal(3),
        pathDefaultDepth: z.literal(5),
        pathMaximumDepth: z.literal(10),
        pathQueryLimit: z.literal(10),
        pathDisplayedLimit: z.literal(3),
        pathExpandedStateLimit: z.literal(10_000),
        chainSegmentLimit: z.literal(10),
      })
      .strict(),
    compatibility: z.object({ toolsWorkWithoutPromptsOrResources: z.literal(true) }).strict(),
  })
  .strict();

export type CapabilityManifest = z.infer<typeof capabilityManifestSchema>;

export const systemStatusResourceSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: z.iso.datetime({ offset: true }),
    overallStatus: z.enum(['ready', 'degraded', 'unavailable']),
    mcp: z
      .object({
        status: z.literal('online'),
        name: z.literal('causality'),
        version: z.string().min(1),
      })
      .strict(),
    api: z
      .object({
        status: z.enum(['online', 'unreachable']),
        reason: z.enum(['api_unreachable']).nullable(),
      })
      .strict(),
    database: z
      .object({
        status: z.enum(['ready', 'unavailable', 'unknown']),
        reason: z.enum(['database_unavailable', 'status_unavailable']).nullable(),
      })
      .strict(),
    semantic: z
      .object({
        status: z.enum(['ready', 'degraded', 'unavailable']),
        workerStatus: z.enum(['online', 'unreachable']).nullable(),
        modelState: z.enum(['idle', 'preparing', 'loaded', 'missing', 'mismatch']).nullable(),
        currentModelCode: semanticModelCodeSchema.nullable(),
        currentModelFileState: semanticModelFileStatusSchema.nullable(),
        indexStatus: semanticIndexStatusSchema.nullable(),
      })
      .strict(),
    enhancedQuery: z
      .object({
        available: z.boolean(),
        reason: z
          .enum([
            'worker_unreachable',
            'model_not_selected',
            'model_not_downloaded',
            'model_not_loaded',
            'index_not_ready',
            'semantic_status_unavailable',
          ])
          .nullable(),
      })
      .strict(),
  })
  .strict();

export type SystemStatusResource = z.infer<typeof systemStatusResourceSchema>;
