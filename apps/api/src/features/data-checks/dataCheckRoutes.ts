import {
  apiErrorSchema,
  dataCheckHandlingRequestSchema,
  dataCheckIssueListQuerySchema,
  dataCheckIssueListResponseSchema,
  dataCheckIssueSchema,
  dataCheckLatestResponseSchema,
} from '@causality/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { z } from 'zod';

import { DataCheckCoordinator } from './dataCheckCoordinator.js';
import { DataCheckRepositoryError, PostgresDataCheckRepository } from './dataCheckRepository.js';
import { createDataCheckRules } from './dataCheckRules.js';
import { DataCheckService } from './dataCheckService.js';

const issueParamsSchema = z.object({ issueId: z.uuid() }).strict();

function sendDataCheckError(error: unknown, reply: FastifyReply) {
  if (error instanceof DataCheckRepositoryError) {
    const status = error.code === 'DATA_CHECK_ISSUE_NOT_FOUND' ? 404 : 409;
    return reply.status(status).send({ code: error.code, message: error.message });
  }
  throw error;
}

export function registerDataCheckRoutes(app: FastifyInstance, pool: Pool): DataCheckCoordinator {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  routes.setValidatorCompiler(validatorCompiler);
  routes.setSerializerCompiler(serializerCompiler);

  const repository = new PostgresDataCheckRepository(pool);
  const scanner = new DataCheckService(pool, createDataCheckRules());
  const coordinator = new DataCheckCoordinator(repository, scanner);

  app.addHook('onReady', async () => {
    await coordinator.recoverInterrupted();
  });
  app.addHook('onClose', async () => {
    await coordinator.waitForCurrent();
  });

  routes.post(
    '/api/data-checks',
    {
      schema: {
        tags: ['data-checks'],
        response: {
          202: dataCheckLatestResponseSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (_request, reply) => reply.status(202).send(await coordinator.start()),
  );

  routes.get(
    '/api/data-checks/latest',
    {
      schema: {
        tags: ['data-checks'],
        response: {
          200: dataCheckLatestResponseSchema,
          500: apiErrorSchema,
        },
      },
    },
    async () => coordinator.latest(),
  );

  routes.get(
    '/api/data-checks/latest/issues',
    {
      schema: {
        tags: ['data-checks'],
        querystring: dataCheckIssueListQuerySchema,
        response: {
          200: dataCheckIssueListResponseSchema,
          400: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (request) => coordinator.listIssues(request.query),
  );

  routes.post(
    '/api/data-checks/issues/:issueId/auto-handle',
    {
      schema: {
        tags: ['data-checks'],
        params: issueParamsSchema,
        body: dataCheckHandlingRequestSchema,
        response: {
          200: dataCheckIssueSchema,
          400: apiErrorSchema,
          404: apiErrorSchema,
          409: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return await coordinator.autoHandle(request.params.issueId, request.body.snapshotId);
      } catch (error) {
        return sendDataCheckError(error, reply);
      }
    },
  );

  routes.post(
    '/api/data-checks/issues/:issueId/manual-handle',
    {
      schema: {
        tags: ['data-checks'],
        params: issueParamsSchema,
        body: dataCheckHandlingRequestSchema,
        response: {
          200: dataCheckIssueSchema,
          400: apiErrorSchema,
          404: apiErrorSchema,
          409: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return await coordinator.manualHandle(request.params.issueId, request.body.snapshotId);
      } catch (error) {
        return sendDataCheckError(error, reply);
      }
    },
  );

  return coordinator;
}
