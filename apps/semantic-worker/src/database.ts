import { Pool } from 'pg';

export function createWorkerDatabasePool(databaseUrl: string): Pool {
  return new Pool({
    connectionString: databaseUrl,
    max: 4,
  });
}
