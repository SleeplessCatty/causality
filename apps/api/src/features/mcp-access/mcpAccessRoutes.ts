import {
  apiErrorSchema,
  createMcpTokenInputSchema,
  createMcpTokenResponseSchema,
  mcpAuthorizationResponseSchema,
  mcpTokenSummarySchema,
  revokeMcpTokenResponseSchema,
} from '@causality/contracts';
import type { FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { z } from 'zod';

import { getRequestActor } from '../auth/requestActor.js';
import { McpAccessServiceError } from './mcpAccessService.js';
import type { McpAccessService } from './mcpAccessService.js';

const tokenParamsSchema = z.object({ tokenId: z.uuid() }).strict();

function errorResponse(error: unknown): {
  status: 401 | 404 | 409;
  body: { code: string; message: string };
} {
  if (error instanceof McpAccessServiceError) {
    if (error.code === 'TOKEN_LIMIT_REACHED') {
      return { status: 409, body: { code: error.code, message: error.message } };
    }
    if (error.code === 'TOKEN_NOT_FOUND') {
      return { status: 404, body: { code: error.code, message: error.message } };
    }
    return { status: 401, body: { code: error.code, message: error.message } };
  }
  throw error;
}

export function registerMcpAccessRoutes(app: FastifyInstance, service: McpAccessService): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  routes.setValidatorCompiler(validatorCompiler);
  routes.setSerializerCompiler(serializerCompiler);

  routes.get(
    '/api/mcp/tokens',
    {
      schema: {
        tags: ['mcp'],
        response: { 200: z.array(mcpTokenSummarySchema), 401: apiErrorSchema },
      },
    },
    async (request, reply) => {
      try {
        return await service.list(getRequestActor(request)!);
      } catch (error) {
        const response = errorResponse(error);
        return reply.status(response.status as never).send(response.body as never);
      }
    },
  );

  routes.post(
    '/api/mcp/tokens',
    {
      schema: {
        tags: ['mcp'],
        body: createMcpTokenInputSchema,
        response: { 201: createMcpTokenResponseSchema, 401: apiErrorSchema, 409: apiErrorSchema },
      },
    },
    async (request, reply) => {
      try {
        const result = await service.create(getRequestActor(request)!, request.body.deviceName);
        return reply.status(201).send(result);
      } catch (error) {
        const response = errorResponse(error);
        return reply.status(response.status as never).send(response.body as never);
      }
    },
  );

  routes.delete(
    '/api/mcp/tokens/:tokenId',
    {
      schema: {
        tags: ['mcp'],
        params: tokenParamsSchema,
        response: { 200: revokeMcpTokenResponseSchema, 401: apiErrorSchema, 404: apiErrorSchema },
      },
    },
    async (request, reply) => {
      try {
        await service.revoke(getRequestActor(request)!, request.params.tokenId);
        return { revoked: true as const };
      } catch (error) {
        const response = errorResponse(error);
        return reply.status(response.status as never).send(response.body as never);
      }
    },
  );
}

export function registerInternalMcpAuthorizationRoute(app: FastifyInstance): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  routes.setValidatorCompiler(validatorCompiler);
  routes.setSerializerCompiler(serializerCompiler);
  routes.post(
    '/authorize',
    {
      schema: {
        hide: true,
        response: { 200: mcpAuthorizationResponseSchema, 401: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const actor = getRequestActor(request);
      if (!actor || actor.actorType !== 'user' || actor.channel !== 'mcp' || !actor.mcpTokenId) {
        return reply.status(401).send({ code: 'MCP_UNAUTHORIZED', message: 'MCP 访问令牌无效' });
      }
      return {
        authorized: true as const,
        userId: actor.userId,
        username: actor.username,
        tokenId: actor.mcpTokenId,
      };
    },
  );
}
