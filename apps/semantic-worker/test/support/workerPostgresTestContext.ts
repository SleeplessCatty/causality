import { Pool } from 'pg';
import { inject } from 'vitest';

import { runMigrations } from '../../../api/src/database/migrate.js';

const databaseName = 'causality_semantic_worker_test';

function pool(database: string): Pool {
  return new Pool({
    host: inject('postgresHost'),
    port: inject('postgresPort'),
    user: inject('postgresUser'),
    password: inject('postgresPassword'),
    database,
  });
}

export async function startWorkerPostgresTestContext(): Promise<{
  pool: Pool;
  close(): Promise<void>;
}> {
  const adminPool = pool('postgres');
  try {
    await adminPool.query(`create database "${databaseName}"`);
  } finally {
    await adminPool.end();
  }

  const databasePool = pool(databaseName);
  try {
    await runMigrations(databasePool);
  } catch (error) {
    await databasePool.end();
    throw error;
  }
  return {
    pool: databasePool,
    close: () => databasePool.end(),
  };
}
