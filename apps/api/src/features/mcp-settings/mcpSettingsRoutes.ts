import {
  apiErrorSchema,
  mcpSettingsResponseSchema,
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

}
