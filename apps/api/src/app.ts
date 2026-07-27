import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
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
import { registerRelationRoutes } from './features/relations/relationRoutes.js';
import { registerCaseRoutes } from './features/cases/caseRoutes.js';
import { registerCausalGraphRoutes } from './features/causal-graph/causalGraphRoutes.js';
import { registerDataCheckRoutes } from './features/data-checks/dataCheckRoutes.js';
import { registerSemanticRoutes } from './features/semantic/semanticRoutes.js';
import { registerDataTransferRoutes } from './features/data-transfer/dataTransferRoutes.js';
import {
  PostgresSemanticQueryContextRepository,
  SemanticQueryService,
} from './features/semantic/semanticQueryService.js';
import { PostgresSemanticSearchRepository } from './features/semantic/semanticSearchRepository.js';
import {
  HttpSemanticWorkerClient,
  type SemanticWorkerClient,
} from './features/semantic/semanticWorkerClient.js';

interface BuildAppOptions {
  logger?: FastifyServerOptions['logger'];
  corsOrigin?: string;
  checkDatabase?: DatabaseReadinessCheck;
  databasePool?: Pool;
  semanticWorkerUrl?: string;
  semanticQueryTimeoutMs?: number;
  semanticWorkerClient?: SemanticWorkerClient;
  importTimeoutMs?: number;
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

  void app.register(multipart, {
    limits: {
      files: 1,
      parts: 1,
      fileSize: 20 * 1024 * 1024,
    },
  });

  app.after(() => {
    registerHealthRoute(app);
    registerReadinessRoute(app, options.checkDatabase ?? (async () => false));
    if (options.databasePool) {
      const semanticWorkerClient =
        options.semanticWorkerClient ??
        new HttpSemanticWorkerClient({
          baseUrl: options.semanticWorkerUrl ?? 'http://127.0.0.1:3100',
          timeoutMs: options.semanticQueryTimeoutMs ?? 10_000,
        });
      const semanticQuery = new SemanticQueryService({
        contextRepository: new PostgresSemanticQueryContextRepository(options.databasePool),
        searchRepository: new PostgresSemanticSearchRepository(options.databasePool),
        workerClient: semanticWorkerClient,
      });
      registerEventRoutes(app, options.databasePool, semanticQuery);
      registerRelationRoutes(app, options.databasePool, semanticQuery);
      registerCaseRoutes(app, options.databasePool, semanticQuery);
      registerCausalGraphRoutes(app, options.databasePool);
      registerDataCheckRoutes(app, options.databasePool);
      registerSemanticRoutes(app, options.databasePool, semanticWorkerClient);
      registerDataTransferRoutes(app, options.databasePool, {
        ...(options.importTimeoutMs === undefined
          ? {}
          : { importTimeoutMs: options.importTimeoutMs }),
      });
    }

    app.get('/api/openapi.json', { schema: { hide: true } }, async () => app.swagger());
  });

  app.setErrorHandler((error, _request, reply) => {
    const validationError = error as { validation?: Array<{ message?: string }> };
    if (validationError.validation) {
      const isRelationSelfLoop = validationError.validation.some(
        (issue) => issue.message === '原因事件和结果事件不能相同',
      );
      if (isRelationSelfLoop) {
        void reply.status(409).send({
          code: 'RELATION_SELF_LOOP',
          message: '原因事件和结果事件不能相同',
          fields: { effectEventId: '原因事件和结果事件不能相同' },
        });
        return;
      }
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
