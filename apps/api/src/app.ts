import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
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
import { PostgresMcpAccessRepository } from './features/mcp-access/mcpAccessRepository.js';
import { McpAccessService } from './features/mcp-access/mcpAccessService.js';
import { createAesGcmMcpTokenCipher } from './features/mcp-access/mcpTokenCipher.js';
import {
  registerInternalMcpAuthorizationRoute,
  registerMcpAccessRoutes,
} from './features/mcp-access/mcpAccessRoutes.js';
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
import { createBusinessAuthHook } from './features/auth/businessAuthHook.js';
import { installRouteAccessRegistry, markBusinessRoutes } from './routes/routeAccess.js';

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
  internalMcpSecret?: string;
  tokenEncryptionKey?: string;
}

const developmentSessionKey = 'ca'.repeat(32);
const developmentSourceKey = 'db'.repeat(32);
const developmentInternalMcpSecret = 'ef'.repeat(32);
const developmentTokenEncryptionKey = Buffer.alloc(32, 0x74).toString('base64');

function createHmacDigest(key: string): (value: string) => Buffer {
  const keyBuffer = Buffer.from(key, 'hex');
  return (value) => createHmac('sha256', keyBuffer).update(value).digest();
}

function firstHeader(
  request: { headers: Record<string, string | string[] | undefined> },
  name: string,
) {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function constantTimeSecretMatches(candidate: string | undefined, expected: string): boolean {
  if (!candidate) return false;
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  return (
    candidateBuffer.length === expectedBuffer.length &&
    timingSafeEqual(candidateBuffer, expectedBuffer)
  );
}

function privateMcpRouteAdapter(app: FastifyInstance): FastifyInstance {
  const adapt = (value: unknown): unknown => {
    if (typeof value !== 'function') return value;
    return (...arguments_: unknown[]) => {
      const [path, options, ...rest] = arguments_;
      if (typeof path !== 'string' || !path.startsWith('/api/')) {
        return Reflect.apply(value as (...args: unknown[]) => unknown, app, arguments_);
      }
      const schema =
        options && typeof options === 'object' && 'schema' in options
          ? { ...((options as { schema?: object }).schema ?? {}), hide: true }
          : { hide: true };
      const nextOptions =
        options && typeof options === 'object' ? { ...(options as object), schema } : { schema };
      return Reflect.apply(value as (...args: unknown[]) => unknown, app, [
        path.slice('/api'.length),
        nextOptions,
        ...rest,
      ]);
    };
  };
  const proxy = new Proxy(app, {
    get(target, property, receiver) {
      if (property === 'withTypeProvider') return () => proxy;
      const value = Reflect.get(target, property, receiver);
      return adapt(value);
    },
  }) as FastifyInstance;
  return proxy;
}

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? false });
  installRouteAccessRegistry(app);

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
      const databasePool = options.databasePool;
      const publicOrigin = options.publicOrigin ?? options.corsOrigin ?? 'http://localhost:5173';
      const authService = new AuthService({
        repository: new PostgresAuthRepository(databasePool),
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
        contextRepository: new PostgresSemanticQueryContextRepository(databasePool),
        searchRepository: new PostgresSemanticSearchRepository(databasePool),
        workerClient: semanticWorkerClient,
      });
      const mcpSettingsService = new McpSettingsService(
        new PostgresMcpSettingsRepository(databasePool),
        {
          endpoint: options.mcpEndpoint ?? 'http://127.0.0.1:8081/mcp',
          healthUrl: options.mcpHealthUrl ?? 'http://127.0.0.1:8081/health',
          ...(options.mcpHealthTimeoutMs === undefined
            ? {}
            : { healthTimeoutMs: options.mcpHealthTimeoutMs }),
        },
      );
      const mcpAccessService = new McpAccessService(
        new PostgresMcpAccessRepository(databasePool),
        new PostgresAuditWriter(),
        createAesGcmMcpTokenCipher(options.tokenEncryptionKey ?? developmentTokenEncryptionKey),
      );
      void app.register(async (business) => {
        markBusinessRoutes(business);
        business.addHook(
          'preHandler',
          createBusinessAuthHook({
            authService,
            publicOrigin,
          }),
        );
        registerEventRoutes(business, databasePool, semanticQuery);
        registerRelationRoutes(business, databasePool, semanticQuery);
        registerCaseRoutes(business, databasePool, semanticQuery);
        registerCausalGraphRoutes(business, databasePool);
        registerCausalEvidenceRoutes(business, databasePool);
        registerDataCheckRoutes(business, databasePool, semanticWorkerClient);
        registerSemanticRoutes(business, databasePool, semanticWorkerClient);
        registerDataTransferRoutes(business, databasePool, {
          ...(options.importTimeoutMs === undefined
            ? {}
            : { importTimeoutMs: options.importTimeoutMs }),
        });
        registerAiCaptureRoutes(
          business,
          createAiCaptureRouteDependencies(
            databasePool,
            semanticWorkerClient,
            options.aiCaptureSemanticCandidates,
          ),
          {
            ...(options.aiCaptureTimeoutMs === undefined
              ? {}
              : { requestTimeoutMs: options.aiCaptureTimeoutMs }),
          },
        );
        registerMcpSettingsRoutes(business, mcpSettingsService);
        registerMcpAccessRoutes(business, mcpAccessService);
        business.get('/api/openapi.json', { schema: { hide: true } }, async () => app.swagger());
      });
      void app.register(
        async (internalMcp) => {
          internalMcp.addHook('preHandler', async (request, reply) => {
            const internalSecret = firstHeader(request, 'x-causality-internal-mcp-secret');
            const rawToken = firstHeader(request, 'x-causality-mcp-token');
            const clientName = firstHeader(request, 'x-causality-mcp-client-name');
            if (
              !constantTimeSecretMatches(
                internalSecret,
                options.internalMcpSecret ?? developmentInternalMcpSecret,
              ) ||
              !rawToken
            ) {
              void reply
                .status(401)
                .send({ code: 'MCP_UNAUTHORIZED', message: 'MCP 访问令牌无效' });
              return;
            }
            const actor = await mcpAccessService.authorize(rawToken, clientName ?? null);
            if (!actor) {
              void reply
                .status(401)
                .send({ code: 'MCP_UNAUTHORIZED', message: 'MCP 访问令牌无效' });
              return;
            }
            request.actor = { ...actor, requestId: request.id };
          });
          registerInternalMcpAuthorizationRoute(internalMcp);
          const privateRoutes = privateMcpRouteAdapter(internalMcp);
          registerHealthRoute(privateRoutes);
          registerReadinessRoute(privateRoutes, options.checkDatabase ?? (async () => false));
          registerEventRoutes(privateRoutes, databasePool, semanticQuery);
          registerRelationRoutes(privateRoutes, databasePool, semanticQuery);
          registerCaseRoutes(privateRoutes, databasePool, semanticQuery);
          registerCausalGraphRoutes(privateRoutes, databasePool);
          registerCausalEvidenceRoutes(privateRoutes, databasePool);
          registerSemanticRoutes(privateRoutes, databasePool, semanticWorkerClient);
          registerAiCaptureRoutes(
            privateRoutes,
            createAiCaptureRouteDependencies(
              databasePool,
              semanticWorkerClient,
              options.aiCaptureSemanticCandidates,
            ),
            {
              ...(options.aiCaptureTimeoutMs === undefined
                ? {}
                : { requestTimeoutMs: options.aiCaptureTimeoutMs }),
            },
          );
        },
        { prefix: '/internal/mcp' },
      );
    }
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
