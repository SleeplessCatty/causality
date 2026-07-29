import {
  apiErrorSchema,
  causalEvidenceBundleInputSchema,
  causalEvidenceBundleResponseSchema,
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
import { PostgresCausalEvidenceBundleRepository } from './causalEvidenceBundleRepository.js';
import {
  CausalEvidenceBundleService,
  CausalEvidenceBundleServiceError,
} from './causalEvidenceBundleService.js';
import { CausalPathService, CausalPathServiceError } from './causalPathService.js';

export function registerCausalEvidenceRoutes(app: FastifyInstance, pool: Pool): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  routes.setValidatorCompiler(validatorCompiler);
  routes.setSerializerCompiler(serializerCompiler);
  const pathService = new CausalPathService(new PostgresCausalPathRepository(pool));
  const evidenceBundleService = new CausalEvidenceBundleService(
    new PostgresCausalEvidenceBundleRepository(pool),
  );

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

  routes.post(
    '/api/causal-evidence-bundles',
    {
      schema: {
        tags: ['causal-evidence'],
        body: causalEvidenceBundleInputSchema,
        response: {
          200: causalEvidenceBundleResponseSchema,
          400: apiErrorSchema,
          404: apiErrorSchema,
          409: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return await evidenceBundleService.build(request.body);
      } catch (error) {
        if (error instanceof CausalEvidenceBundleServiceError) {
          const status = error.code === 'EVIDENCE_RELATION_NOT_FOUND' ? 404 : 409;
          return reply.status(status).send({
            code: error.code,
            message: error.message,
            fields: {
              ['relationIds.' + error.relationIndex]: error.suggestedAction,
            },
          });
        }
        throw error;
      }
    },
  );
}
