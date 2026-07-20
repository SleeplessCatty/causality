import cors from '@fastify/cors';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

import { registerHealthRoute } from './routes/health.js';
import { registerReadinessRoute, type DatabaseReadinessCheck } from './routes/readiness.js';

interface BuildAppOptions {
  logger?: FastifyServerOptions['logger'];
  corsOrigin?: string;
  checkDatabase?: DatabaseReadinessCheck;
}

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? false });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  void app.register(cors, {
    origin: options.corsOrigin ?? 'http://localhost:5173',
  });

  registerHealthRoute(app);
  registerReadinessRoute(app, options.checkDatabase ?? (async () => false));

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    void reply.status(500).send({ error: 'Internal Server Error' });
  });

  return app;
}
