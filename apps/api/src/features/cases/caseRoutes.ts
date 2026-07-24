import {
  apiErrorSchema,
  caseDeletionImpactSchema,
  caseCandidateListResponseSchema,
  caseCandidateQuerySchema,
  caseDetailSchema,
  caseFormInputSchema,
  caseListQuerySchema,
  caseListResponseSchema,
  caseRelationListQuerySchema,
  caseRelationListResponseSchema,
  deleteResultSchema,
} from '@causality/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { InvalidCaseCursorError } from './caseCursor.js';
import { PostgresCaseRepository } from './caseRepository.js';
import { CaseService, CaseServiceError } from './caseService.js';
import {
  SemanticQueryError,
  semanticQueryErrorStatus,
  type SemanticQueryService,
} from '../semantic/semanticQueryService.js';

const caseParamsSchema = z.object({ caseId: z.uuid() }).strict();

function sendCaseError(error: unknown, reply: FastifyReply) {
  if (error instanceof SemanticQueryError) {
    return reply
      .status(semanticQueryErrorStatus(error))
      .send({ code: error.code, message: error.message });
  }
  if (error instanceof InvalidCaseCursorError) {
    return reply.status(400).send({ code: 'VALIDATION_ERROR', message: '分页游标不合法' });
  }
  if (error instanceof CaseServiceError) {
    return reply.status(error.code === 'CASE_NOT_FOUND' ? 404 : 409).send({
      code: error.code,
      message: error.message,
      ...(error.existingId ? { existingId: error.existingId } : {}),
    });
  }
  throw error;
}

export function registerCaseRoutes(
  app: FastifyInstance,
  pool: Pool,
  semanticQuery: SemanticQueryService,
): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const service = new CaseService(new PostgresCaseRepository(pool), semanticQuery);

  routes.get(
    '/api/cases',
    {
      schema: {
        tags: ['cases'],
        querystring: caseListQuerySchema,
        response: {
          200: caseListResponseSchema,
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
        return sendCaseError(error, reply);
      }
    },
  );

  routes.get(
    '/api/cases/candidates',
    {
      schema: {
        tags: ['cases'],
        querystring: caseCandidateQuerySchema,
        response: {
          200: caseCandidateListResponseSchema,
          400: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return await service.candidates(request.query);
      } catch (error) {
        return sendCaseError(error, reply);
      }
    },
  );

  routes.get(
    '/api/cases/:caseId/deletion-impact',
    {
      schema: {
        tags: ['cases'],
        params: caseParamsSchema,
        response: {
          200: caseDeletionImpactSchema,
          400: apiErrorSchema,
          404: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return await service.deletionImpact(request.params.caseId);
      } catch (error) {
        return sendCaseError(error, reply);
      }
    },
  );

  routes.get(
    '/api/cases/:caseId/relations',
    {
      schema: {
        tags: ['cases'],
        params: caseParamsSchema,
        querystring: caseRelationListQuerySchema,
        response: {
          200: caseRelationListResponseSchema,
          400: apiErrorSchema,
          404: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return await service.listRelations(request.params.caseId, request.query);
      } catch (error) {
        return sendCaseError(error, reply);
      }
    },
  );

  routes.get(
    '/api/cases/:caseId',
    {
      schema: {
        tags: ['cases'],
        params: caseParamsSchema,
        response: {
          200: caseDetailSchema,
          400: apiErrorSchema,
          404: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return await service.findById(request.params.caseId);
      } catch (error) {
        return sendCaseError(error, reply);
      }
    },
  );

  routes.post(
    '/api/cases',
    {
      schema: {
        tags: ['cases'],
        body: caseFormInputSchema,
        response: {
          201: caseDetailSchema,
          400: apiErrorSchema,
          409: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return reply.status(201).send(await service.create(request.body));
      } catch (error) {
        return sendCaseError(error, reply);
      }
    },
  );

  routes.put(
    '/api/cases/:caseId',
    {
      schema: {
        tags: ['cases'],
        params: caseParamsSchema,
        body: caseFormInputSchema,
        response: {
          200: caseDetailSchema,
          400: apiErrorSchema,
          404: apiErrorSchema,
          409: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return await service.replace(request.params.caseId, request.body);
      } catch (error) {
        return sendCaseError(error, reply);
      }
    },
  );

  routes.delete(
    '/api/cases/:caseId',
    {
      schema: {
        tags: ['cases'],
        params: caseParamsSchema,
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
        return await service.delete(request.params.caseId);
      } catch (error) {
        return sendCaseError(error, reply);
      }
    },
  );
}
