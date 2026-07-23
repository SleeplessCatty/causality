import {
  apiErrorSchema,
  semanticModelParamsSchema,
  semanticSettingsResponseSchema,
  semanticThresholdInputSchema,
  semanticUseModelResponseSchema,
} from '@causality/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Pool } from 'pg';

import { PostgresSemanticRepository } from './semanticRepository.js';
import { SemanticService } from './semanticService.js';
import { SemanticRepositoryError } from './semanticTypes.js';

function sendSemanticError(error: unknown, reply: FastifyReply) {
  if (error instanceof SemanticRepositoryError) {
    return reply.status(409).send({ code: error.code, message: error.message });
  }
  throw error;
}

export function registerSemanticRoutes(app: FastifyInstance, pool: Pool): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  routes.setValidatorCompiler(validatorCompiler);
  routes.setSerializerCompiler(serializerCompiler);
  const service = new SemanticService(new PostgresSemanticRepository(pool));

  routes.get(
    '/api/semantic/settings',
    {
      schema: {
        tags: ['semantic'],
        response: {
          200: semanticSettingsResponseSchema,
          500: apiErrorSchema,
        },
      },
    },
    async () => service.settings(),
  );

  routes.patch(
    '/api/semantic/models/:modelCode/threshold',
    {
      schema: {
        tags: ['semantic'],
        params: semanticModelParamsSchema,
        body: semanticThresholdInputSchema,
        response: {
          200: semanticSettingsResponseSchema,
          400: apiErrorSchema,
          409: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return await service.updateThreshold(request.params.modelCode, request.body.threshold);
      } catch (error) {
        return sendSemanticError(error, reply);
      }
    },
  );

  routes.post(
    '/api/semantic/models/:modelCode/use',
    {
      schema: {
        tags: ['semantic'],
        params: semanticModelParamsSchema,
        response: {
          202: semanticUseModelResponseSchema,
          400: apiErrorSchema,
          409: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const result = await service.useModel(request.params.modelCode);
        return reply.status(202).send(result);
      } catch (error) {
        return sendSemanticError(error, reply);
      }
    },
  );

  routes.post(
    '/api/semantic/retry',
    {
      schema: {
        tags: ['semantic'],
        response: {
          202: semanticUseModelResponseSchema,
          409: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (_request, reply) => {
      try {
        const result = await service.retry();
        return reply.status(202).send(result);
      } catch (error) {
        return sendSemanticError(error, reply);
      }
    },
  );
}
