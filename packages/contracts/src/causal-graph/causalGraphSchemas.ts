import { z } from 'zod';

import { eventNameSchema } from '../events/eventSchemas.js';
import { relationConfidenceSchema } from '../relations/relationSchemas.js';

const graphLimitSchema = z.union([z.literal(20), z.literal(50), z.literal(100)]);
const relationLimitSchema = z.union([z.literal(200), z.literal(500), z.literal(1_000)]);
const graphDirectionSchema = z.enum(['upstream', 'downstream', 'both']);
const graphStopReasonSchema = z.enum(['exhausted', 'node_limit', 'relation_limit']);

export const causalGraphQuerySchema = z
  .object({
    centerEventId: z.uuid(),
    direction: graphDirectionSchema,
    limit: z.coerce.number().pipe(graphLimitSchema).default(20),
    minConfidence: z.coerce.number().int().min(0).max(100).default(0),
    minCaseCount: z.coerce.number().int().nonnegative().default(0),
  })
  .strict();

export const causalGraphNodeSchema = z
  .object({
    id: z.uuid(),
    name: eventNameSchema,
  })
  .strict();

export const causalGraphRelationSchema = z
  .object({
    id: z.uuid(),
    causeEventId: z.uuid(),
    effectEventId: z.uuid(),
    confidence: relationConfidenceSchema,
    caseCount: z.number().int().nonnegative(),
  })
  .strict();

export const causalGraphResponseSchema = z
  .object({
    nodes: z.array(causalGraphNodeSchema).max(101),
    relations: z.array(causalGraphRelationSchema).max(1_000),
    meta: z
      .object({
        centerEventId: z.uuid(),
        direction: graphDirectionSchema,
        nodeLimit: graphLimitSchema,
        relationLimit: relationLimitSchema,
        minConfidence: z.number().int().min(0).max(100),
        minCaseCount: z.number().int().nonnegative(),
        nodeCount: z.number().int().min(1).max(101),
        relationCount: z.number().int().min(0).max(1_000),
        stopReason: graphStopReasonSchema,
      })
      .strict(),
  })
  .strict();

export type CausalGraphQuery = z.infer<typeof causalGraphQuerySchema>;
export type CausalGraphNode = z.infer<typeof causalGraphNodeSchema>;
export type CausalGraphRelation = z.infer<typeof causalGraphRelationSchema>;
export type CausalGraphResponse = z.infer<typeof causalGraphResponseSchema>;
export type CausalGraphStopReason = z.infer<typeof graphStopReasonSchema>;
