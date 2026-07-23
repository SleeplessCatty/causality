import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closePostgresTestPool, startPostgresTestContext } from './support/postgresTestContext.js';
import { isDatabaseReady } from '../src/database/readiness.js';

describe('PostgreSQL readiness', () => {
  let app: FastifyInstance | undefined;
  let context: Awaited<ReturnType<typeof startPostgresTestContext>> | undefined;
  let pool: Pool | undefined;

  beforeAll(async () => {
    context = await startPostgresTestContext('causality_readiness_test');
    ({ pool, app } = context);
  }, 120_000);

  afterAll(async () => {
    await context?.close();
  });

  it('requires semantic storage but not an active or downloaded model', async () => {
    const state = await pool!.query<{
      active_model_code: string | null;
      status: string;
    }>(
      `select active_model_code, status
       from semantic_index_state`,
    );
    expect(state.rows).toEqual([{ active_model_code: null, status: 'empty' }]);
    await expect(isDatabaseReady(pool!)).resolves.toBe(true);

    const client = await pool!.connect();
    try {
      await client.query('begin');
      await client.query('drop table semantic_jobs');
      await expect(isDatabaseReady(client)).resolves.toBe(false);
    } finally {
      await client.query('rollback');
      client.release();
    }
  });

  it('changes from ready to unavailable after the pool is closed', async () => {
    const readyResponse = await app!.inject({ method: 'GET', url: '/api/ready' });

    expect(readyResponse.statusCode).toBe(200);
    expect(readyResponse.json()).toEqual({
      status: 'ready',
      database: 'available',
    });

    await closePostgresTestPool(pool!);

    const unavailableResponse = await app!.inject({ method: 'GET', url: '/api/ready' });
    expect(unavailableResponse.statusCode).toBe(503);
    expect(unavailableResponse.json()).toEqual({
      status: 'not_ready',
      database: 'unavailable',
    });
  });
});
