import {
  apiErrorSchema,
  causalGraphQuerySchema,
  causalGraphResponseSchema,
} from '@causality/contracts';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';

import { PostgresCausalGraphRepository } from './causalGraphRepository.js';
import { CausalGraphService, CausalGraphServiceError } from './causalGraphService.js';

export function registerCausalGraphRoutes(app: FastifyInstance, pool: Pool): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  routes.setValidatorCompiler(validatorCompiler);
  routes.setSerializerCompiler(serializerCompiler);
  const service = new CausalGraphService(new PostgresCausalGraphRepository(pool));

  routes.get(
    '/api/causal-graph',
    {
      schema: {
        tags: ['causal-graph'],
        querystring: causalGraphQuerySchema,
        response: {
          200: causalGraphResponseSchema,
          400: apiErrorSchema,
          404: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return await service.query(request.query);
      } catch (error) {
        if (error instanceof CausalGraphServiceError && error.code === 'EVENT_NOT_FOUND') {
          return reply.status(404).send({ code: 'EVENT_NOT_FOUND', message: error.message });
        }
        throw error;
      }
    },
  );
}
