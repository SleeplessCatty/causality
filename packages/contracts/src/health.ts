import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('causality-api'),
});

export const readinessResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ready'),
    database: z.literal('available'),
  }),
  z.object({
    status: z.literal('not_ready'),
    database: z.literal('unavailable'),
  }),
]);

export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
