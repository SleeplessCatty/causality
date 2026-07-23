import { z } from 'zod';

export const eventDeletionImpactSchema = z
  .object({
    canDelete: z.boolean(),
    hasRelations: z.boolean(),
  })
  .strict();

export const relationDeletionImpactSchema = z
  .object({
    canDelete: z.literal(true),
    hasEvents: z.literal(true),
    hasCases: z.boolean(),
  })
  .strict();

export const caseDeletionImpactSchema = z
  .object({
    canDelete: z.literal(true),
    hasRelations: z.boolean(),
  })
  .strict();

export const deleteResultSchema = z.object({ deleted: z.literal(true) }).strict();

export type EventDeletionImpact = z.infer<typeof eventDeletionImpactSchema>;
export type RelationDeletionImpact = z.infer<typeof relationDeletionImpactSchema>;
export type CaseDeletionImpact = z.infer<typeof caseDeletionImpactSchema>;
export type DeleteResult = z.infer<typeof deleteResultSchema>;
