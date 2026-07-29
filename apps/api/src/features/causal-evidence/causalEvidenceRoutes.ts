import {
  apiErrorSchema,
  causalPathQuerySchema,
  causalPathResponseSchema,
} from '@causality/contracts';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';

import { PostgresCausalPathRepository } from './causalPathRepository.js';
import { CausalPathService, CausalPathServiceError } from './causalPathService.js';

export function registerCausalEvidenceRoutes(app: FastifyInstance, pool: Pool): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  routes.setValidatorCompiler(validatorCompiler);
  routes.setSerializerCompiler(serializerCompiler);
  const pathService = new CausalPathService(new PostgresCausalPathRepository(pool));

  routes.get(
    '/api/causal-paths',
    {
      schema: {
        tags: ['causal-evidence'],
        querystring: causalPathQuerySchema,
        response: {
          200: causalPathResponseSchema,
          400: apiErrorSchema,
          404: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return await pathService.query(request.query);
      } catch (error) {
        if (error instanceof CausalPathServiceError) {
          return reply.status(404).send({
            code: error.code,
            message: error.message,
          });
        }
        throw error;
      }
    },
  );
}
