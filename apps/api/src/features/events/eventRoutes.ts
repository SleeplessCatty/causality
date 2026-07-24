import {
  apiErrorSchema,
  deleteResultSchema,
  eventCandidateListResponseSchema,
  eventCandidateQuerySchema,
  eventDetailSchema,
  eventDeletionImpactSchema,
  eventFormInputSchema,
  eventListQuerySchema,
  eventListResponseSchema,
  eventRelationListQuerySchema,
  eventRelationListResponseSchema,
} from '@causality/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { z } from 'zod';

import { PostgresEventRepository } from './eventRepository.js';
import { InvalidEventCursorError } from './eventCursor.js';
import { EventService, EventServiceError } from './eventService.js';
import {
  SemanticQueryError,
  semanticQueryErrorStatus,
  type SemanticQueryService,
} from '../semantic/semanticQueryService.js';

const eventParamsSchema = z.object({ eventId: z.uuid() }).strict();

function sendEventError(error: unknown, reply: FastifyReply) {
  if (error instanceof SemanticQueryError) {
    return reply
      .status(semanticQueryErrorStatus(error))
      .send({ code: error.code, message: error.message });
  }
  if (error instanceof InvalidEventCursorError) {
    return reply.status(400).send({
      code: 'VALIDATION_ERROR',
      message: '分页游标不合法',
    });
  }
  if (error instanceof EventServiceError) {
    const status = error.code === 'EVENT_NOT_FOUND' ? 404 : 409;
    const fields = error.field ? { [error.field]: error.message } : undefined;
    return reply.status(status).send({
      code: error.code,
      message: error.message,
      ...(fields ? { fields } : {}),
    });
  }
  throw error;
}

export function registerEventRoutes(
  app: FastifyInstance,
  pool: Pool,
  semanticQuery: SemanticQueryService,
): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  routes.setValidatorCompiler(validatorCompiler);
  routes.setSerializerCompiler(serializerCompiler);
  const service = new EventService(new PostgresEventRepository(pool), semanticQuery);

  routes.get(
    '/api/events',
    {
      schema: {
        tags: ['events'],
        querystring: eventListQuerySchema,
        response: {
          200: eventListResponseSchema,
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
        return sendEventError(error, reply);
      }
    },
  );

  routes.get(
    '/api/events/candidates',
    {
      schema: {
        tags: ['events'],
        querystring: eventCandidateQuerySchema,
        response: {
          200: eventCandidateListResponseSchema,
          400: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return await service.findCandidates(request.query);
      } catch (error) {
        return sendEventError(error, reply);
      }
    },
  );

  routes.get(
    '/api/events/:eventId/deletion-impact',
    {
      schema: {
        tags: ['events'],
        params: eventParamsSchema,
        response: {
          200: eventDeletionImpactSchema,
          400: apiErrorSchema,
          404: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return await service.deletionImpact(request.params.eventId);
      } catch (error) {
        return sendEventError(error, reply);
      }
    },
  );

  routes.get(
    '/api/events/:eventId/relations',
    {
      schema: {
        tags: ['events'],
        params: eventParamsSchema,
        querystring: eventRelationListQuerySchema,
        response: {
          200: eventRelationListResponseSchema,
          400: apiErrorSchema,
          404: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return await service.listRelations(request.params.eventId, request.query);
      } catch (error) {
        return sendEventError(error, reply);
      }
    },
  );

  routes.get(
    '/api/events/:eventId',
    {
      schema: {
        tags: ['events'],
        params: eventParamsSchema,
        response: {
          200: eventDetailSchema,
          400: apiErrorSchema,
          404: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return await service.findById(request.params.eventId);
      } catch (error) {
        return sendEventError(error, reply);
      }
    },
  );

  routes.post(
    '/api/events',
    {
      schema: {
        tags: ['events'],
        body: eventFormInputSchema,
        response: {
          201: eventDetailSchema,
          400: apiErrorSchema,
          409: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const event = await service.create(request.body);
        return reply.status(201).send(event);
      } catch (error) {
        return sendEventError(error, reply);
      }
    },
  );

  routes.put(
    '/api/events/:eventId',
    {
      schema: {
        tags: ['events'],
        params: eventParamsSchema,
        body: eventFormInputSchema,
        response: {
          200: eventDetailSchema,
          400: apiErrorSchema,
          404: apiErrorSchema,
          409: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return await service.replace(request.params.eventId, request.body);
      } catch (error) {
        return sendEventError(error, reply);
      }
    },
  );

  routes.delete(
    '/api/events/:eventId',
    {
      schema: {
        tags: ['events'],
        params: eventParamsSchema,
        response: {
          200: deleteResultSchema,
          400: apiErrorSchema,
          404: apiErrorSchema,
          409: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return await service.delete(request.params.eventId);
      } catch (error) {
        return sendEventError(error, reply);
      }
    },
  );
}
