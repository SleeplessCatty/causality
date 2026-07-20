import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('causality-api'),
});

export const readyResponseSchema = z.object({
  status: z.literal('ready'),
  database: z.literal('available'),
});

export const notReadyResponseSchema = z.object({
  status: z.literal('not_ready'),
  database: z.literal('unavailable'),
});

export const readinessResponseSchema = z.discriminatedUnion('status', [
  readyResponseSchema,
  notReadyResponseSchema,
]);

export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
