import { z } from 'zod';

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
