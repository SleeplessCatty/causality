import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';

import * as schema from './schema/index.js';

export function createDatabaseClient(pool: Pool) {
  return drizzle(pool, { schema });
}

export type DatabaseClient = ReturnType<typeof createDatabaseClient>;
