import {
  apiErrorSchema,
  mcpAuthorizationResponseSchema,
  mcpSettingsResponseSchema,
  mcpTokenRotationResponseSchema,
} from '@causality/contracts';
import type { FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';

import type { McpSettingsService } from './mcpSettingsService.js';

export function registerMcpSettingsRoutes(app: FastifyInstance, service: McpSettingsService): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  routes.setValidatorCompiler(validatorCompiler);
  routes.setSerializerCompiler(serializerCompiler);

  routes.get(
    '/api/mcp/settings',
    {
      schema: {
        tags: ['mcp'],
        response: {
          200: mcpSettingsResponseSchema,
          500: apiErrorSchema,
        },
      },
    },
    async () => service.get(),
  );

  routes.post(
    '/api/mcp/settings/rotate-token',
    {
      schema: {
        tags: ['mcp'],
        response: {
          200: mcpTokenRotationResponseSchema,
          500: apiErrorSchema,
        },
      },
    },
    async () => service.rotate(),
  );

  routes.post(
    '/api/mcp/authorize',
    {
      schema: {
        tags: ['mcp'],
        response: {
          200: mcpAuthorizationResponseSchema,
          401: apiErrorSchema,
          500: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const raw = request.headers['x-causality-mcp-token'];
      const token = Array.isArray(raw) ? raw[0] : raw;
      const authorization = token ? await service.authorize(token) : null;
      if (!authorization) {
        return reply.status(401).send({
          code: 'MCP_UNAUTHORIZED',
          message: 'MCP 访问令牌无效',
        });
      }
      return authorization;
    },
  );
}
