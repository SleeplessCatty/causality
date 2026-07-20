import type { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { isDatabaseReady } from '../src/database/readiness.js';

describe('PostgreSQL readiness', () => {
  let app: FastifyInstance | undefined;
  let container: StartedTestContainer | undefined;
  let pool: Pool | undefined;

  beforeAll(async () => {
    container = await new GenericContainer('postgres:18.4-alpine')
      .withEnvironment({
        POSTGRES_DB: 'causality_test',
        POSTGRES_USER: 'causality',
        POSTGRES_PASSWORD: 'causality',
      })
      .withExposedPorts(5432)
      .withHealthCheck({
        test: ['CMD-SHELL', 'pg_isready -U causality -d causality_test'],
        interval: 1_000,
        timeout: 3_000,
        retries: 30,
      })
      .withWaitStrategy(Wait.forHealthCheck())
      .withStartupTimeout(120_000)
      .start();

    pool = new Pool({
      connectionString: `postgresql://causality:causality@${container.getHost()}:${container.getMappedPort(5432)}/causality_test`,
    });
    app = buildApp({ logger: false, checkDatabase: () => isDatabaseReady(pool!) });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await container?.stop();
  });

  it('changes from ready to unavailable after the pool is closed', async () => {
    const readyResponse = await app!.inject({ method: 'GET', url: '/api/ready' });

    expect(readyResponse.statusCode).toBe(200);
    expect(readyResponse.json()).toEqual({
      status: 'ready',
      database: 'available',
    });

    await pool!.end();

    const unavailableResponse = await app!.inject({ method: 'GET', url: '/api/ready' });
    expect(unavailableResponse.statusCode).toBe(503);
    expect(unavailableResponse.json()).toEqual({
      status: 'not_ready',
      database: 'unavailable',
    });
  });
});
