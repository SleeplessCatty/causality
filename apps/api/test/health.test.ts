import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';

describe('API foundation', () => {
  const apps: Array<ReturnType<typeof buildApp>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('returns the fixed health response without checking the database', async () => {
    let databaseChecks = 0;
    const app = buildApp({
      logger: false,
      checkDatabase: async () => {
        databaseChecks += 1;
        return true;
      },
    });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', service: 'causality-api' });
    expect(databaseChecks).toBe(0);
  });

  it('returns 404 for an unknown route', async () => {
    const app = buildApp({ logger: false, checkDatabase: async () => true });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/missing' });

    expect(response.statusCode).toBe(404);
  });

  it('publishes the health and readiness routes as OpenAPI JSON', async () => {
    const app = buildApp({ logger: false, checkDatabase: async () => true });
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/openapi.json',
    });
    const document = response.json<{
      info: { title: string; version: string };
      openapi: string;
      paths: Record<string, unknown>;
    }>();

    expect(response.statusCode).toBe(200);
    expect(document.openapi).toMatch(/^3\./);
    expect(document.info).toEqual({
      title: 'Causality API',
      version: '0.1.0',
    });
    expect(document.paths).toHaveProperty('/api/health');
    expect(document.paths).toHaveProperty('/api/ready');
  });

  it('reports database check failures as unavailable without leaking details', async () => {
    const app = buildApp({
      logger: false,
      checkDatabase: async () => {
        throw new Error('password=private-value');
      },
    });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/api/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: 'not_ready',
      database: 'unavailable',
    });
    expect(response.body).not.toContain('private-value');
  });

  it('does not expose internal errors to clients', async () => {
    const app = buildApp({ logger: false, checkDatabase: async () => true });
    apps.push(app);
    app.get('/test-error', async () => {
      throw new Error('postgresql://user:password@private-host/database');
    });

    const response = await app.inject({ method: 'GET', url: '/test-error' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      code: 'INTERNAL_ERROR',
      message: '服务器内部错误',
    });
    expect(response.body).not.toContain('password');
    expect(response.body).not.toContain('private-host');
  });
});

describe('environment configuration', () => {
  it('applies non-sensitive defaults', () => {
    expect(parseEnv({ DATABASE_URL: 'postgresql://localhost/causality' })).toMatchObject({
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: 3000,
      LOG_LEVEL: 'info',
      CORS_ORIGIN: 'http://localhost:5173',
      SEMANTIC_WORKER_URL: 'http://127.0.0.1:3100',
      SEMANTIC_QUERY_TIMEOUT_MS: 10_000,
      AI_CAPTURE_TIMEOUT_MS: 30_000,
      CAUSALITY_MCP_ENDPOINT: 'http://127.0.0.1:8081/mcp',
      CAUSALITY_MCP_HEALTH_URL: 'http://127.0.0.1:8081/health',
      CAUSALITY_MCP_HEALTH_TIMEOUT_MS: 1_000,
    });
  });

  it('fails when DATABASE_URL is missing', () => {
    expect(() => parseEnv({})).toThrow('Invalid environment configuration');
  });
});
