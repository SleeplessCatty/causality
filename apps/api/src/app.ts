import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import Fastify, { type FastifyServerOptions } from 'fastify';
import type { Pool } from 'pg';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';

import { registerHealthRoute } from './routes/health.js';
import { registerReadinessRoute, type DatabaseReadinessCheck } from './routes/readiness.js';
import { registerEventRoutes } from './features/events/eventRoutes.js';

interface BuildAppOptions {
  logger?: FastifyServerOptions['logger'];
  corsOrigin?: string;
  checkDatabase?: DatabaseReadinessCheck;
  databasePool?: Pool;
}

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? false });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  void app.register(swagger, {
    openapi: {
      info: {
        title: 'Causality API',
        version: '0.1.0',
      },
    },
    transform: jsonSchemaTransform,
  });

  void app.register(cors, {
    origin: options.corsOrigin ?? 'http://localhost:5173',
  });

  app.after(() => {
    registerHealthRoute(app);
    registerReadinessRoute(app, options.checkDatabase ?? (async () => false));
    if (options.databasePool) registerEventRoutes(app, options.databasePool);

    app.get('/api/openapi.json', { schema: { hide: true } }, async () => app.swagger());
  });

  app.setErrorHandler((error, _request, reply) => {
    const validationError = error as { validation?: unknown };
    if (validationError.validation) {
      void reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: '请求参数不合法',
      });
      return;
    }
    app.log.error(error);
    void reply.status(500).send({ code: 'INTERNAL_ERROR', message: '服务器内部错误' });
  });

  return app;
}
