import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
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
import { createCausalityMcpServer, type CausalityMcpApi } from '../server/createMcpServer.js';

const DEFAULT_MAX_BODY_BYTES = 8 * 1024 * 1024;

export interface McpTransportLogger {
  info(...values: unknown[]): void;
  error(...values: unknown[]): void;
}

export interface StartCausalityMcpHttpServerOptions {
  apiBaseUrl: string;
  host?: string;
  port?: number;
  allowedOrigins?: string[];
  maxBodyBytes?: number;
  apiTimeoutMs?: number;
  fetch?: typeof fetch;
  logger?: McpTransportLogger;
}

interface Session {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
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
  const match = /^Bearer ([0-9a-f]{64})$/.exec(authorization);
  return match?.[1] ?? null;
}

function contentLengthExceeds(request: IncomingMessage, limit: number): boolean {
  const raw = request.headers['content-length'];
  if (raw === undefined) return false;
  const value = Array.isArray(raw) ? raw[0] : raw;
  const length = Number(value);
  return Number.isFinite(length) && length > limit;
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

function requestScopedApi(storage: AsyncLocalStorage<CausalityApiClient>): CausalityMcpApi {
  return new Proxy({} as CausalityMcpApi, {
    get(_target, property) {
      return (...args: unknown[]) => {
        const apiClient = storage.getStore();
        if (!apiClient) throw new Error('MCP request context is unavailable');
        const method = Reflect.get(apiClient, property);
        if (typeof method !== 'function') throw new Error('Unsupported Causality API operation');
        return Reflect.apply(method, apiClient, args);
      };
    },
  });
}

async function authorize(
  apiBaseUrl: string,
  token: string,
  fetchImplementation: typeof fetch,
): Promise<boolean> {
  try {
    const response = await fetchImplementation(new URL('/api/mcp/authorize', apiBaseUrl), {
      method: 'POST',
      headers: { 'x-causality-mcp-token': token },
    });
    if (!response.ok) return false;
    return mcpAuthorizationResponseSchema.safeParse(await response.json()).success;
  } catch {
    return false;
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
  const fetchImplementation = options.fetch ?? fetch;
  const logger = options.logger ?? console;
  const sessions = new Map<string, Session>();
  const requestStorage = new AsyncLocalStorage<CausalityApiClient>();
  const scopedApi = requestScopedApi(requestStorage);

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

    const origin = request.headers.origin;
    if (origin !== undefined && !allowedOrigins.has(origin)) {
      sendJson(response, 403, { error: 'forbidden_origin' });
      return;
    }

    const token = bearerToken(request);
    if (!token) {
      sendJson(response, 401, { error: 'unauthorized' });
      return;
    }
    if (contentLengthExceeds(request, maxBodyBytes)) {
      sendJson(response, 413, { error: 'request_too_large' });
      return;
    }
    if (!(await authorize(options.apiBaseUrl, token, fetchImplementation))) {
      sendJson(response, 401, { error: 'unauthorized' });
      return;
    }

    let body: unknown;
    if (request.method === 'POST') {
      try {
        body = await readJsonBody(request, maxBodyBytes);
      } catch (error) {
        sendJson(
          response,
          error instanceof Error && error.name === 'BodyTooLargeError' ? 413 : 400,
          {
            error:
              error instanceof Error && error.name === 'BodyTooLargeError'
                ? 'request_too_large'
                : 'invalid_json',
          },
        );
        return;
      }
    }

    const apiClient = new CausalityApiClient({
      baseUrl: options.apiBaseUrl,
      token,
      fetch: fetchImplementation,
      ...(options.apiTimeoutMs === undefined ? {} : { timeoutMs: options.apiTimeoutMs }),
    });
    const rawSessionId = request.headers['mcp-session-id'];
    const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;
    let session = sessionId ? sessions.get(sessionId) : undefined;

    try {
      if (!session && !sessionId && request.method === 'POST' && isInitializeRequest(body)) {
        const server = createCausalityMcpServer({ apiClient: scopedApi, logger });
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: randomUUID,
          enableJsonResponse: true,
          onsessioninitialized: (initializedSessionId) => {
            sessions.set(initializedSessionId, { server, transport });
          },
        });
        transport.onclose = () => {
          const initializedSessionId = transport.sessionId;
          if (initializedSessionId) sessions.delete(initializedSessionId);
        };
        await server.connect(transport as unknown as Parameters<McpServer['connect']>[0]);
        session = { server, transport };
      }

      if (!session) {
        sendJson(response, sessionId ? 404 : 400, { error: 'invalid_mcp_session' });
        return;
      }
      await requestStorage.run(apiClient, () =>
        session!.transport.handleRequest(request, response, body),
      );
    } catch (error) {
      logger.error({
        event: 'mcp_request_failed',
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
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
