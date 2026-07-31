import { createHmac, randomBytes } from 'node:crypto';

import cookie from '@fastify/cookie';
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
import { registerCausalEvidenceRoutes } from './features/causal-evidence/causalEvidenceRoutes.js';
import { registerDataCheckRoutes } from './features/data-checks/dataCheckRoutes.js';
import { registerSemanticRoutes } from './features/semantic/semanticRoutes.js';
import { registerDataTransferRoutes } from './features/data-transfer/dataTransferRoutes.js';
import {
  createAiCaptureRouteDependencies,
  registerAiCaptureRoutes,
  type AiCaptureSemanticCandidates,
} from './features/ai-capture/aiCaptureRoutes.js';
import { PostgresMcpSettingsRepository } from './features/mcp-settings/mcpSettingsRepository.js';
import { McpSettingsService } from './features/mcp-settings/mcpSettingsService.js';
import { registerMcpSettingsRoutes } from './features/mcp-settings/mcpSettingsRoutes.js';
import {
  PostgresSemanticQueryContextRepository,
  SemanticQueryService,
} from './features/semantic/semanticQueryService.js';
import { PostgresSemanticSearchRepository } from './features/semantic/semanticSearchRepository.js';
import {
  HttpSemanticWorkerClient,
  type SemanticWorkerClient,
} from './features/semantic/semanticWorkerClient.js';
import { PostgresAuditWriter } from './features/audit/auditRepository.js';
import { PostgresAuthRepository } from './features/auth/authRepository.js';
import { registerAuthRoutes } from './features/auth/authRoutes.js';
import { AuthService } from './features/auth/authService.js';
import { argon2idPasswordHasher } from './features/auth/passwordHasher.js';

export interface BuildAppOptions {
  logger?: FastifyServerOptions['logger'];
  corsOrigin?: string;
  checkDatabase?: DatabaseReadinessCheck;
  databasePool?: Pool;
  semanticWorkerUrl?: string;
  semanticQueryTimeoutMs?: number;
  semanticWorkerClient?: SemanticWorkerClient;
  importTimeoutMs?: number;
  aiCaptureTimeoutMs?: number;
  aiCaptureSemanticCandidates?: AiCaptureSemanticCandidates;
  mcpEndpoint?: string;
  mcpHealthUrl?: string;
  mcpHealthTimeoutMs?: number;
  publicOrigin?: string;
  cookieSecure?: boolean;
  sessionHmacKey?: string;
  authIpHashKey?: string;
}

const developmentSessionKey = 'ca'.repeat(32);
const developmentSourceKey = 'db'.repeat(32);

function createHmacDigest(key: string): (value: string) => Buffer {
  const keyBuffer = Buffer.from(key, 'hex');
  return (value) => createHmac('sha256', keyBuffer).update(value).digest();
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
    credentials: true,
  });

  void app.register(cookie);

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
      const publicOrigin = options.publicOrigin ?? options.corsOrigin ?? 'http://localhost:5173';
      const authService = new AuthService({
        repository: new PostgresAuthRepository(options.databasePool),
        auditWriter: new PostgresAuditWriter(),
        passwordHasher: argon2idPasswordHasher,
        clock: () => new Date(),
        tokenGenerator: () => randomBytes(32).toString('base64url'),
        sessionDigest: createHmacDigest(options.sessionHmacKey ?? developmentSessionKey),
        sourceDigest: createHmacDigest(options.authIpHashKey ?? developmentSourceKey),
      });
      registerAuthRoutes(app, authService, {
        publicOrigin,
        secure: options.cookieSecure ?? false,
      });
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
      registerCausalEvidenceRoutes(app, options.databasePool);
      registerDataCheckRoutes(app, options.databasePool, semanticWorkerClient);
      registerSemanticRoutes(app, options.databasePool, semanticWorkerClient);
      registerDataTransferRoutes(app, options.databasePool, {
        ...(options.importTimeoutMs === undefined
          ? {}
          : { importTimeoutMs: options.importTimeoutMs }),
      });
      registerAiCaptureRoutes(
        app,
        createAiCaptureRouteDependencies(
          options.databasePool,
          semanticWorkerClient,
          options.aiCaptureSemanticCandidates,
        ),
        {
          ...(options.aiCaptureTimeoutMs === undefined
            ? {}
            : { requestTimeoutMs: options.aiCaptureTimeoutMs }),
        },
      );
      registerMcpSettingsRoutes(
        app,
        new McpSettingsService(new PostgresMcpSettingsRepository(options.databasePool), {
          endpoint: options.mcpEndpoint ?? 'http://127.0.0.1:8081/mcp',
          healthUrl: options.mcpHealthUrl ?? 'http://127.0.0.1:8081/health',
          ...(options.mcpHealthTimeoutMs === undefined
            ? {}
            : { healthTimeoutMs: options.mcpHealthTimeoutMs }),
        }),
      );
    }

    app.get('/api/openapi.json', { schema: { hide: true } }, async () => app.swagger());
  });

  app.setErrorHandler((error, request, reply) => {
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
    const rawTraceId = request.headers['x-causality-trace-id'];
    const traceId = Array.isArray(rawTraceId) ? rawTraceId[0] : rawTraceId;
    request.log.error(
      {
        err: error,
        traceId: typeof traceId === 'string' ? traceId : null,
      },
      'request failed',
    );
    void reply.status(500).send({ code: 'INTERNAL_ERROR', message: '服务器内部错误' });
  });

  return app;
}
