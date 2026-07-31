import type { Pool } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const contextMocks = vi.hoisted(() => ({
  buildApp: vi.fn(),
  pools: [] as Pool[],
  runMigrations: vi.fn(),
}));

vi.mock('pg', () => ({
  Pool: vi.fn(function Pool() {
    const pool = contextMocks.pools.shift();
    if (!pool) throw new Error('No PostgreSQL test pool was queued');
    return pool;
  }),
}));

vi.mock('../src/app.js', () => ({ buildApp: contextMocks.buildApp }));
vi.mock('../src/database/migrate.js', () => ({ runMigrations: contextMocks.runMigrations }));
vi.mock('../src/database/readiness.js', () => ({ isDatabaseReady: vi.fn() }));

import { closePostgresTestPool, startPostgresTestContext } from './support/postgresTestContext.js';

describe('PostgreSQL test context', () => {
  beforeEach(() => {
    contextMocks.buildApp.mockReset();
    contextMocks.pools.length = 0;
    contextMocks.runMigrations.mockReset();
    contextMocks.runMigrations.mockResolvedValue(undefined);
  });

  it('rejects database names outside the integration-suite allowlist', async () => {
    await expect(startPostgresTestContext('causality_untrusted_test')).rejects.toThrow(
      'Unsupported integration test database',
    );
  });

  it('closes a test pool at most once', async () => {
    const end = vi.fn(async () => undefined);
    const pool = { end } as unknown as Pool;

    await closePostgresTestPool(pool);
    await closePostgresTestPool(pool);

    expect(end).toHaveBeenCalledOnce();
  });

  it('closes the Fastify app before its database pool', async () => {
    const closeOrder: string[] = [];
    const adminPool = createPool();
    const databasePool = createPool(() => {
      closeOrder.push('pool');
    });
    const app = createApp({
      close: () => {
        closeOrder.push('app');
      },
    });
    contextMocks.pools.push(adminPool, databasePool);
    contextMocks.buildApp.mockReturnValue(app);

    const context = await startPostgresTestContext('causality_cases_test', {
      createAuthenticatedSession: false,
    });
    closeOrder.length = 0;
    await context.close();

    expect(closeOrder).toEqual(['app', 'pool']);
  });

  it('closes the database pool when migrations fail', async () => {
    const adminPool = createPool();
    const databasePool = createPool();
    contextMocks.pools.push(adminPool, databasePool);
    contextMocks.runMigrations.mockRejectedValueOnce(new Error('migration failed'));

    await expect(startPostgresTestContext('causality_cases_test')).rejects.toThrow(
      'migration failed',
    );

    expect(databasePool.end).toHaveBeenCalledOnce();
    expect(contextMocks.buildApp).not.toHaveBeenCalled();
  });

  it('closes the app before the pool when app initialization fails', async () => {
    const closeOrder: string[] = [];
    const adminPool = createPool();
    const databasePool = createPool(() => {
      closeOrder.push('pool');
    });
    const app = createApp({
      close: () => {
        closeOrder.push('app');
      },
      ready: async () => {
        throw new Error('app initialization failed');
      },
    });
    contextMocks.pools.push(adminPool, databasePool);
    contextMocks.buildApp.mockReturnValue(app);

    await expect(startPostgresTestContext('causality_cases_test')).rejects.toThrow(
      'app initialization failed',
    );

    expect(closeOrder).toEqual(['app', 'pool']);
  });
});

function createPool(onEnd: () => void = () => undefined): Pool {
  return {
    end: vi.fn(async () => onEnd()),
    query: vi.fn(async () => ({ rows: [] })),
  } as unknown as Pool;
}

function createApp(
  overrides: {
    close?: () => void | Promise<void>;
    ready?: () => void | Promise<void>;
  } = {},
) {
  return {
    close: vi.fn(overrides.close ?? (async () => undefined)),
    ready: vi.fn(overrides.ready ?? (async () => undefined)),
    inject: vi.fn(),
  };
}
