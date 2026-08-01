import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http';

import { mcpAuthorizationResponseSchema } from '@causality/contracts';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

import { CausalityApiClient } from '../api/causalityApiClient.js';
import type { McpPrincipal } from '../auth/mcpPrincipal.js';
import {
  describeMcpMessage,
  markMcpRequestProtocolError,
  observeMcpRequest,
  type McpLogger,
} from '../observability/mcpRequestLogging.js';
import { createCausalityMcpServer, type CausalityMcpApi } from '../server/createMcpServer.js';

const DEFAULT_MAX_BODY_BYTES = 8 * 1024 * 1024;

export type McpTransportLogger = McpLogger;

export interface StartCausalityMcpHttpServerOptions {
  apiBaseUrl: string;
  host?: string;
  port?: number;
  allowedOrigins?: string[];
  maxBodyBytes?: number;
  apiTimeoutMs?: number;
  internalSecret: string;
  fetch?: typeof fetch;
  logger?: McpTransportLogger;
  trustedProxyAddresses?: string[];
}

interface Session {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  clientName?: string;
  clientVersion?: string;
}

export interface CausalityMcpHttpServer {
  httpServer: HttpServer;
  close(): Promise<void>;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent) return;
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function bearerToken(request: IncomingMessage): string | null {
  const authorization = request.headers.authorization;
  if (!authorization) return null;
  const match = /^Bearer (cau_pat_[A-Za-z0-9_-]{43})$/.exec(authorization);
  return match?.[1] ?? null;
}

function normalizeIp(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes(',') || /[\s\r\n]/.test(trimmed)) return null;
  const normalized = trimmed.startsWith('::ffff:') ? trimmed.slice('::ffff:'.length) : trimmed;
  return /^[0-9a-fA-F:.]+$/.test(normalized) ? normalized.toLowerCase() : null;
}

function requestSource(request: IncomingMessage, trustedProxyAddresses: Set<string>): string {
  const remote = normalizeIp(request.socket.remoteAddress ?? '') ?? 'unknown';
  const forwarded = request.headers['x-causality-client-ip'];
  const candidate = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (trustedProxyAddresses.has(remote) && candidate) return normalizeIp(candidate) ?? remote;
  return remote;
}

function tokenRateKey(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function contentLengthExceeds(request: IncomingMessage, limit: number): boolean {
  const raw = request.headers['content-length'];
  if (raw === undefined) return false;
  const value = Array.isArray(raw) ? raw[0] : raw;
  const length = Number(value);
  return Number.isFinite(length) && length > limit;
}

function initializeClientInfo(body: unknown): Pick<Session, 'clientName' | 'clientVersion'> {
  if (!isInitializeRequest(body)) return {};
  const clientInfo = body.params.clientInfo;
  return {
    ...(typeof clientInfo.name === 'string' ? { clientName: clientInfo.name } : {}),
    ...(typeof clientInfo.version === 'string' ? { clientVersion: clientInfo.version } : {}),
  };
}

async function readJsonBody(request: IncomingMessage, limit: number): Promise<unknown> {
  let total = 0;
  const chunks: Buffer[] = [];
  for await (const rawChunk of request) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    total += chunk.byteLength;
    if (total > limit) {
      const error = new Error('request body too large');
      error.name = 'BodyTooLargeError';
      throw error;
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

interface McpRequestContext {
  apiClient: CausalityApiClient;
  principal: McpPrincipal;
}

function requestScopedApi(storage: AsyncLocalStorage<McpRequestContext>): CausalityMcpApi {
  return new Proxy({} as CausalityMcpApi, {
    get(_target, property) {
      return (...args: unknown[]) => {
        const context = storage.getStore();
        if (!context) throw new Error('MCP request context is unavailable');
        const method = Reflect.get(context.apiClient, property);
        if (typeof method !== 'function') throw new Error('Unsupported Causality API operation');
        return Reflect.apply(method, context.apiClient, args);
      };
    },
  });
}

async function authorize(
  apiBaseUrl: string,
  token: string,
  internalSecret: string,
  fetchImplementation: typeof fetch,
  clientName: string | null,
): Promise<McpPrincipal | null> {
  try {
    const base = new URL(apiBaseUrl);
    const response = await fetchImplementation(new URL('/internal/mcp/authorize', base), {
      method: 'POST',
      headers: {
        'x-causality-mcp-token': token,
        'x-causality-internal-mcp-secret': internalSecret,
        ...(clientName ? { 'x-causality-mcp-client-name': clientName } : {}),
      },
    });
    if (!response.ok) return null;
    const parsed = mcpAuthorizationResponseSchema.safeParse(await response.json());
    return parsed.success
      ? { userId: parsed.data.userId, username: parsed.data.username, tokenId: parsed.data.tokenId }
      : null;
  } catch {
    return null;
  }
}

class SlidingWindowRateLimiter {
  private readonly requests = new Map<string, number[]>();

  public allow(key: string, limit: number, now = Date.now()): boolean {
    const cutoff = now - 60_000;
    const recent = (this.requests.get(key) ?? []).filter((time) => time > cutoff);
    if (recent.length >= limit) {
      this.requests.set(key, recent);
      return false;
    }
    recent.push(now);
    this.requests.set(key, recent);
    return true;
  }
}

function listen(server: HttpServer, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

function closeHttpServer(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

export async function startCausalityMcpHttpServer(
  options: StartCausalityMcpHttpServerOptions,
): Promise<CausalityMcpHttpServer> {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 8081;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const allowedOrigins = new Set(
    options.allowedOrigins ?? ['http://127.0.0.1:5173', 'http://localhost:5173'],
  );
  const trustedProxyAddresses = new Set<string>(
    (options.trustedProxyAddresses ?? ['127.0.0.1', '::1'])
      .map((address) => normalizeIp(address))
      .filter((address): address is string => address !== null),
  );
  const fetchImplementation = options.fetch ?? fetch;
  const logger = options.logger ?? console;
  const sessions = new Map<string, Session>();
  const requestStorage = new AsyncLocalStorage<McpRequestContext>();
  const scopedApi = requestScopedApi(requestStorage);
  const rateLimiter = new SlidingWindowRateLimiter();

  const httpServer = createServer(async (request, response) => {
    const path = new URL(request.url ?? '/', `http://${host}`).pathname;
    if (path === '/health' && request.method === 'GET') {
      sendJson(response, 200, { status: 'ok' });
      return;
    }
    if (path !== '/mcp') {
      sendJson(response, 404, { error: 'not_found' });
      return;
    }
    const requestId = randomUUID();
    const rejectProtocol = async (status: number, errorCode: string) => {
      await observeMcpRequest(
        { requestId, transport: 'streamable-http', method: 'http/request' },
        () => {
          markMcpRequestProtocolError(errorCode);
          sendJson(response, status, { error: errorCode });
        },
        logger,
      );
    };

    const origin = request.headers.origin;
    if (origin !== undefined && !allowedOrigins.has(origin)) {
      await rejectProtocol(403, 'forbidden_origin');
      return;
    }

    const token = bearerToken(request);
    const sourceAllowed = rateLimiter.allow(`source:${requestSource(request, trustedProxyAddresses)}`, 120);
    const tokenAllowed = token ? rateLimiter.allow(`token:${tokenRateKey(token)}`, 60) : true;
    if (!sourceAllowed || !tokenAllowed) {
      await rejectProtocol(429, 'rate_limited');
      return;
    }
    if (!token) {
      await rejectProtocol(401, 'unauthorized');
      return;
    }
    if (contentLengthExceeds(request, maxBodyBytes)) {
      await rejectProtocol(413, 'request_too_large');
      return;
    }
    let body: unknown;
    if (request.method === 'POST') {
      try {
        body = await readJsonBody(request, maxBodyBytes);
      } catch (error) {
        const tooLarge = error instanceof Error && error.name === 'BodyTooLargeError';
        await rejectProtocol(tooLarge ? 413 : 400, tooLarge ? 'request_too_large' : 'invalid_json');
        return;
      }
    }
    const rawSessionId = request.headers['mcp-session-id'];
    const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;
    let session = sessionId ? sessions.get(sessionId) : undefined;
    const initializingClient = initializeClientInfo(body);
    const principal = await authorize(
      options.apiBaseUrl,
      token,
      options.internalSecret,
      fetchImplementation,
      session?.clientName ?? initializingClient.clientName ?? null,
    );
    if (!principal) {
      await rejectProtocol(401, 'unauthorized');
      return;
    }

    const apiClient = new CausalityApiClient({
      baseUrl: options.apiBaseUrl,
      token,
      internalSecret: options.internalSecret,
      pathPrefix: '/internal/mcp',
      fetch: fetchImplementation,
      ...(options.apiTimeoutMs === undefined ? {} : { timeoutMs: options.apiTimeoutMs }),
    });
    try {
      if (!session && !sessionId && request.method === 'POST' && isInitializeRequest(body)) {
        const server = createCausalityMcpServer({ apiClient: scopedApi, logger });
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: randomUUID,
          enableJsonResponse: true,
          onsessioninitialized: (initializedSessionId) => {
            sessions.set(initializedSessionId, initializedSession);
          },
        });
        const initializedSession: Session = { server, transport, ...initializingClient };
        transport.onclose = () => {
          const initializedSessionId = transport.sessionId;
          if (initializedSessionId) sessions.delete(initializedSessionId);
        };
        await server.connect(transport as unknown as Parameters<McpServer['connect']>[0]);
        session = initializedSession;
      }

      if (!session) {
        await observeMcpRequest(
          {
            requestId,
            transport: 'streamable-http',
            ...describeMcpMessage(body),
            ...initializingClient,
          },
          () => {
            markMcpRequestProtocolError('invalid_mcp_session');
            sendJson(response, sessionId ? 404 : 400, { error: 'invalid_mcp_session' });
          },
          logger,
        );
        return;
      }
      await observeMcpRequest(
        {
          requestId,
          transport: 'streamable-http',
          ...describeMcpMessage(body),
          ...(session.clientName === undefined ? {} : { clientName: session.clientName }),
          ...(session.clientVersion === undefined ? {} : { clientVersion: session.clientVersion }),
        },
        () =>
          requestStorage.run({ apiClient, principal }, () =>
            session!.transport.handleRequest(request, response, body),
          ),
        logger,
      );
    } catch {
      sendJson(response, 500, { error: 'internal_error' });
    }
  });

  await listen(httpServer, host, port);
  logger.info('Causality MCP HTTP server started');

  return {
    httpServer,
    async close() {
      await Promise.all(
        Array.from(sessions.values()).map(async ({ server }) => {
          await server.close();
        }),
      );
      sessions.clear();
      await closeHttpServer(httpServer);
    },
  };
}
