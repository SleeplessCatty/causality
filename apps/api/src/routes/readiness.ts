import { notReadyResponseSchema, readyResponseSchema } from '@causality/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

export type DatabaseReadinessCheck = () => Promise<boolean>;

export function registerReadinessRoute(
  app: FastifyInstance,
  checkDatabase: DatabaseReadinessCheck,
): void {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/api/ready',
    {
      config: { routeAccess: 'public' },
      schema: {
        tags: ['system'],
        response: {
          200: readyResponseSchema,
          503: notReadyResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      const databaseAvailable = await checkDatabase().catch(() => false);

      if (!databaseAvailable) {
        return reply.status(503).send({
          status: 'not_ready' as const,
          database: 'unavailable' as const,
        });
      }

      return {
        status: 'ready' as const,
        database: 'available' as const,
      };
    },
  );
}
