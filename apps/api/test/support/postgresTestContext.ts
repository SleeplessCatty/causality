import { Pool } from 'pg';
import { inject } from 'vitest';

import { buildApp } from '../../src/app.js';
import { runMigrations } from '../../src/database/migrate.js';
import { isDatabaseReady } from '../../src/database/readiness.js';
import type { SemanticWorkerClient } from '../../src/features/semantic/semanticWorkerClient.js';

const allowedDatabaseNames = new Set([
  'causality_cases_test',
  'causality_core_model_test',
  'causality_data_checks_test',
  'causality_data_transfer_test',
  'causality_database_tools_test',
  'causality_events_test',
  'causality_graph_test',
  'causality_readiness_test',
  'causality_relations_test',
  'causality_semantic_test',
]);

const poolClosures = new WeakMap<Pool, Promise<void>>();

export function createPostgresTestPool(database: string): Pool {
  return new Pool({
    host: inject('postgresHost'),
    port: inject('postgresPort'),
    user: inject('postgresUser'),
    password: inject('postgresPassword'),
    database,
  });
}

export function closePostgresTestPool(pool: Pool): Promise<void> {
  const existingClosure = poolClosures.get(pool);
  if (existingClosure) return existingClosure;

  const closure = pool.end();
  poolClosures.set(pool, closure);
  return closure;
}

export type StartedPostgresTestContext = {
  pool: Pool;
  app: ReturnType<typeof buildApp>;
  close(): Promise<void>;
};

export async function startPostgresTestContext(
  databaseName: string,
  options: { semanticWorkerClient?: SemanticWorkerClient } = {},
): Promise<StartedPostgresTestContext> {
  if (!allowedDatabaseNames.has(databaseName)) {
    throw new Error(`Unsupported integration test database: ${databaseName}`);
  }

  const adminPool = createPostgresTestPool('postgres');
  try {
    await adminPool.query(`create database "${databaseName}"`);
  } finally {
    await closePostgresTestPool(adminPool);
  }

  const pool = createPostgresTestPool(databaseName);
  let app: ReturnType<typeof buildApp> | undefined;
  try {
    await runMigrations(pool);
    app = buildApp({
      logger: false,
      checkDatabase: () => isDatabaseReady(pool),
      databasePool: pool,
      ...(options.semanticWorkerClient
        ? { semanticWorkerClient: options.semanticWorkerClient }
        : {}),
    });
    await app.ready();
  } catch (error) {
    try {
      await app?.close();
    } finally {
      await closePostgresTestPool(pool);
    }
    throw error;
  }

  return {
    pool,
    app,
    async close() {
      try {
        await app.close();
      } finally {
        await closePostgresTestPool(pool);
      }
    },
  };
}
