import { healthResponseSchema } from '@causality/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

export function registerHealthRoute(app: FastifyInstance): void {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/api/health',
    {
      config: { routeAccess: 'public' },
      schema: {
        tags: ['system'],
        response: { 200: healthResponseSchema },
      },
    },
    async () => ({
      status: 'ok' as const,
      service: 'causality-api' as const,
    }),
  );
}
