import {
  apiErrorSchema,
  deleteResultSchema,
  relationDetailSchema,
  relationDeletionImpactSchema,
  relationCaseListQuerySchema,
  relationCaseListResponseSchema,
  relationFormInputSchema,
  relationListQuerySchema,
  relationListResponseSchema,
  relationPairCheckQuerySchema,
  relationPairCheckResponseSchema,
} from '@causality/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { z } from 'zod';

import { InvalidCaseCursorError } from '../cases/caseCursor.js';
import { PostgresCaseRepository } from '../cases/caseRepository.js';
import { PostgresRelationRepository } from './relationRepository.js';
import { RelationService, RelationServiceError } from './relationService.js';
import {
  SemanticQueryError,
  semanticQueryErrorStatus,
  type SemanticQueryService,
} from '../semantic/semanticQueryService.js';

const relationParamsSchema = z.object({ relationId: z.uuid() }).strict();

function sendRelationError(error: unknown, reply: FastifyReply) {
  if (error instanceof SemanticQueryError) {
    return reply
      .status(semanticQueryErrorStatus(error))
      .send({ code: error.code, message: error.message });
  }
  if (error instanceof InvalidCaseCursorError) {
    return reply.status(400).send({ code: 'VALIDATION_ERROR', message: '分页游标不合法' });
  }
  if (error instanceof RelationServiceError) {
    const status =
      error.code === 'RELATION_NOT_FOUND' || error.code === 'CASE_NOT_FOUND'
        ? 404
        : error.code === 'RELATION_EVENT_NOT_FOUND'
          ? 400
          : 409;
    const fields = error.field ? { [error.field]: error.message } : undefined;
    return reply.status(status).send({
      code: error.code,
      message: error.message,
      ...(fields ? { fields } : {}),
      ...(error.existingId ? { existingId: error.existingId } : {}),
    });
  }
  throw error;
}

export function registerRelationRoutes(
  app: FastifyInstance,
  pool: Pool,
  semanticQuery: SemanticQueryService,
): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  routes.setValidatorCompiler(validatorCompiler);
  routes.setSerializerCompiler(serializerCompiler);
  const service = new RelationService(new PostgresRelationRepository(pool), semanticQuery);
  const caseRepository = new PostgresCaseRepository(pool);

  routes.get(
    '/api/relations',
    {
      schema: {
        tags: ['relations'],
        querystring: relationListQuerySchema,
        response: {
          200: relationListResponseSchema,
          400: apiErrorSchema,
          409: apiErrorSchema,
          503: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return await service.list(request.query);
      } catch (error) {
        return sendRelationError(error, reply);
      }
    },
  );

  routes.get(
    '/api/relations/pair-check',
    {
      schema: {
        tags: ['relations'],
        querystring: relationPairCheckQuerySchema,
        response: {
          200: relationPairCheckResponseSchema,
          400: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (request) => service.checkPair(request.query),
  );

  routes.get(
    '/api/relations/:relationId/deletion-impact',
    {
      schema: {
        tags: ['relations'],
        params: relationParamsSchema,
        response: {
          200: relationDeletionImpactSchema,
          400: apiErrorSchema,
          404: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return await service.deletionImpact(request.params.relationId);
      } catch (error) {
        return sendRelationError(error, reply);
      }
    },
  );

  routes.get(
    '/api/relations/:relationId/cases',
    {
      schema: {
        tags: ['relations'],
        params: relationParamsSchema,
        querystring: relationCaseListQuerySchema,
        response: {
          200: relationCaseListResponseSchema,
          400: apiErrorSchema,
          404: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        await service.findById(request.params.relationId);
        return await caseRepository.listForRelation(request.params.relationId, request.query);
      } catch (error) {
        return sendRelationError(error, reply);
      }
    },
  );

  routes.get(
    '/api/relations/:relationId',
    {
      schema: {
        tags: ['relations'],
        params: relationParamsSchema,
        response: {
          200: relationDetailSchema,
          400: apiErrorSchema,
          404: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return await service.findById(request.params.relationId);
      } catch (error) {
        return sendRelationError(error, reply);
      }
    },
  );

  routes.post(
    '/api/relations',
    {
      schema: {
        tags: ['relations'],
        body: relationFormInputSchema,
        response: {
          201: relationDetailSchema,
          400: apiErrorSchema,
          409: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const relation = await service.create(request.body);
        return reply.status(201).send(relation);
      } catch (error) {
        return sendRelationError(error, reply);
      }
    },
  );

  routes.put(
    '/api/relations/:relationId',
    {
      schema: {
        tags: ['relations'],
        params: relationParamsSchema,
        body: relationFormInputSchema,
        response: {
          200: relationDetailSchema,
          400: apiErrorSchema,
          404: apiErrorSchema,
          409: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return await service.replace(request.params.relationId, request.body);
      } catch (error) {
        return sendRelationError(error, reply);
      }
    },
  );

  routes.delete(
    '/api/relations/:relationId',
    {
      schema: {
        tags: ['relations'],
        params: relationParamsSchema,
        response: {
          200: deleteResultSchema,
          400: apiErrorSchema,
          404: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return await service.delete(request.params.relationId);
      } catch (error) {
        return sendRelationError(error, reply);
      }
    },
  );
}
