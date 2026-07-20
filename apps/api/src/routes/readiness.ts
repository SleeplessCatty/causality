import type { FastifyInstance } from 'fastify';

export type DatabaseReadinessCheck = () => Promise<boolean>;

export function registerReadinessRoute(
  app: FastifyInstance,
  checkDatabase: DatabaseReadinessCheck,
): void {
  app.get('/api/ready', async (_request, reply) => {
    const databaseAvailable = await checkDatabase().catch(() => false);

    if (!databaseAvailable) {
      return reply.status(503).send({
        status: 'not_ready',
        database: 'unavailable',
      });
    }

    return {
      status: 'ready',
      database: 'available',
    };
  });
}
