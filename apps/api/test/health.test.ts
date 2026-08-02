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

  it('does not expose the business OpenAPI document without the authentication database', async () => {
    const app = buildApp({ logger: false, checkDatabase: async () => true });
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/openapi.json',
    });
    expect(response.statusCode).toBe(404);
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
  const developmentTokenEncryptionKey = Buffer.alloc(32, 0x74).toString('base64');

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
      CAUSALITY_PUBLIC_ORIGIN: 'http://localhost:5173',
      CAUSALITY_COOKIE_SECURE: false,
      CAUSALITY_SESSION_HMAC_KEY: 'ca'.repeat(32),
      CAUSALITY_AUTH_IP_HASH_KEY: 'db'.repeat(32),
      CAUSALITY_INTERNAL_MCP_SECRET: 'ef'.repeat(32),
      CAUSALITY_TOKEN_ENCRYPTION_KEY: developmentTokenEncryptionKey,
    });
  });

  it('fails when DATABASE_URL is missing', () => {
    expect(() => parseEnv({})).toThrow('Invalid environment configuration');
  });

  it('requires independent non-placeholder production authentication secrets', () => {
    const base = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://localhost/causality',
      CAUSALITY_PUBLIC_ORIGIN: 'https://causality.example.com',
      CAUSALITY_COOKIE_SECURE: 'true',
      CAUSALITY_SESSION_HMAC_KEY: '12'.repeat(32),
      CAUSALITY_AUTH_IP_HASH_KEY: '34'.repeat(32),
      CAUSALITY_INTERNAL_MCP_SECRET: '56'.repeat(32),
      CAUSALITY_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 0x78).toString('base64'),
    };

    expect(parseEnv(base)).toMatchObject({
      CAUSALITY_COOKIE_SECURE: true,
      CAUSALITY_SESSION_HMAC_KEY: '12'.repeat(32),
      CAUSALITY_AUTH_IP_HASH_KEY: '34'.repeat(32),
      CAUSALITY_INTERNAL_MCP_SECRET: '56'.repeat(32),
      CAUSALITY_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 0x78).toString('base64'),
    });
    expect(() => parseEnv({ ...base, CAUSALITY_SESSION_HMAC_KEY: undefined })).toThrow();
    expect(() => parseEnv({ ...base, CAUSALITY_TOKEN_ENCRYPTION_KEY: undefined })).toThrow();
    expect(() =>
      parseEnv({ ...base, CAUSALITY_TOKEN_ENCRYPTION_KEY: developmentTokenEncryptionKey }),
    ).toThrow();
    expect(() =>
      parseEnv({ ...base, CAUSALITY_TOKEN_ENCRYPTION_KEY: Buffer.alloc(31).toString('base64') }),
    ).toThrow();
    expect(() =>
      parseEnv({
        ...base,
        CAUSALITY_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 0x78).toString('base64').replace(/=$/, ''),
      }),
    ).toThrow();
    expect(() =>
      parseEnv({ ...base, CAUSALITY_AUTH_IP_HASH_KEY: base.CAUSALITY_SESSION_HMAC_KEY }),
    ).toThrow();
    expect(() => parseEnv({ ...base, CAUSALITY_SESSION_HMAC_KEY: '0'.repeat(64) })).toThrow();
  });

  it('permits insecure cookies only for exact loopback origins', () => {
    const base = {
      DATABASE_URL: 'postgresql://localhost/causality',
      CAUSALITY_COOKIE_SECURE: 'false',
      CAUSALITY_SESSION_HMAC_KEY: '12'.repeat(32),
      CAUSALITY_AUTH_IP_HASH_KEY: '34'.repeat(32),
    };

    expect(parseEnv({ ...base, CAUSALITY_PUBLIC_ORIGIN: 'http://127.0.0.1:5173' })).toMatchObject({
      CAUSALITY_COOKIE_SECURE: false,
    });
    expect(() =>
      parseEnv({ ...base, CAUSALITY_PUBLIC_ORIGIN: 'http://192.168.1.20:5173' }),
    ).toThrow();
    expect(() =>
      parseEnv({ ...base, CAUSALITY_PUBLIC_ORIGIN: 'http://localhost.example.com' }),
    ).toThrow();
  });
});
