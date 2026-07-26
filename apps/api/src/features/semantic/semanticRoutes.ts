import {
  apiErrorSchema,
  semanticActionAcceptedSchema,
  semanticLifecycleSnapshotSchema,
  semanticModelParamsSchema,
  semanticSettingsResponseSchema,
  semanticThresholdInputSchema,
} from '@causality/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Pool } from 'pg';

import { PostgresSemanticCommandRepository } from './semanticCommandRepository.js';
import { PostgresSemanticLifecycleRepository } from './semanticLifecycleRepository.js';
import { PostgresSemanticRepository } from './semanticRepository.js';
import { SemanticLifecycleService, SemanticService } from './semanticService.js';
import { SemanticRepositoryError } from './semanticTypes.js';
import type { SemanticWorkerClient } from './semanticWorkerClient.js';

function sendSemanticError(error: unknown, reply: FastifyReply) {
  if (error instanceof SemanticRepositoryError) {
    return reply.status(409).send({ code: error.code, message: error.message });
  }
  throw error;
}

export function registerSemanticRoutes(
  app: FastifyInstance,
  pool: Pool,
  workerClient: SemanticWorkerClient,
): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  routes.setValidatorCompiler(validatorCompiler);
  routes.setSerializerCompiler(serializerCompiler);
  const service = new SemanticService(
    new PostgresSemanticRepository(pool),
    new PostgresSemanticCommandRepository(pool),
  );
  const lifecycleService = new SemanticLifecycleService(
    new PostgresSemanticLifecycleRepository(pool),
    workerClient,
  );

  routes.get(
    '/api/semantic/lifecycle',
    {
      schema: {
        tags: ['semantic'],
        response: {
          200: semanticLifecycleSnapshotSchema,
          500: apiErrorSchema,
        },
      },
    },
    async () => lifecycleService.lifecycle(),
  );

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
          200: semanticLifecycleSnapshotSchema,
          400: apiErrorSchema,
          409: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return await lifecycleService.updateThreshold(
          request.params.modelCode,
          request.body.threshold,
        );
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
          202: semanticActionAcceptedSchema,
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
    '/api/semantic/models/:modelCode/retry-download',
    {
      schema: {
        tags: ['semantic'],
        params: semanticModelParamsSchema,
        response: {
          202: semanticActionAcceptedSchema,
          400: apiErrorSchema,
          409: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const result = await service.retryDownload(request.params.modelCode);
        return reply.status(202).send(result);
      } catch (error) {
        return sendSemanticError(error, reply);
      }
    },
  );

  routes.post(
    '/api/semantic/models/:modelCode/redownload',
    {
      schema: {
        tags: ['semantic'],
        params: semanticModelParamsSchema,
        response: {
          202: semanticActionAcceptedSchema,
          400: apiErrorSchema,
          409: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const result = await service.redownload(request.params.modelCode);
        return reply.status(202).send(result);
      } catch (error) {
        return sendSemanticError(error, reply);
      }
    },
  );

  routes.post(
    '/api/semantic/models/:modelCode/retry-load',
    {
      schema: {
        tags: ['semantic'],
        params: semanticModelParamsSchema,
        response: {
          202: semanticActionAcceptedSchema,
          400: apiErrorSchema,
          409: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const result = await service.retryLoad(request.params.modelCode);
        return reply.status(202).send(result);
      } catch (error) {
        return sendSemanticError(error, reply);
      }
    },
  );

  routes.post(
    '/api/semantic/models/:modelCode/retry-full-index',
    {
      schema: {
        tags: ['semantic'],
        params: semanticModelParamsSchema,
        response: {
          202: semanticActionAcceptedSchema,
          400: apiErrorSchema,
          409: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const result = await service.retryFullIndex(request.params.modelCode);
        return reply.status(202).send(result);
      } catch (error) {
        return sendSemanticError(error, reply);
      }
    },
  );

  routes.post(
    '/api/semantic/reindex',
    {
      schema: {
        tags: ['semantic'],
        response: {
          202: semanticActionAcceptedSchema,
          409: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (_request, reply) => {
      try {
        const result = await service.reindex();
        return reply.status(202).send(result);
      } catch (error) {
        return sendSemanticError(error, reply);
      }
    },
  );
}
