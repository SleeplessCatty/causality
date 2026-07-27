import 'dotenv/config';

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

import { parseEnv } from '../config/env.js';
import { createDatabaseClient } from './client.js';

const migrationsFolder = fileURLToPath(new URL('../../../../database/migrations', import.meta.url));

export async function runMigrations(pool: Pool): Promise<void> {
  await migrate(createDatabaseClient(pool), { migrationsFolder });
}

function formatMigrationError(error: unknown): string {
  const messages: string[] = [];
  const visited = new Set<unknown>();
  let current = error;
  while (current !== undefined && current !== null && !visited.has(current)) {
    visited.add(current);
    if (current instanceof Error) {
      messages.push(current.stack ?? current.message);
      current = current.cause;
      continue;
    }
    messages.push(String(current));
    break;
  }
  return messages.join('\nCaused by:\n');
}

async function main(): Promise<void> {
  const env = parseEnv(process.env);
  const pool = new Pool({ connectionString: env.DATABASE_URL });

  try {
    await runMigrations(pool);
    process.stdout.write('Database migrations applied successfully.\n');
  } catch (error) {
    process.stderr.write('Database migration failed.\n');
    process.stderr.write(`${formatMigrationError(error)}\n`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

const executedFile = process.argv[1]
  ? fileURLToPath(new URL(`file://${process.argv[1]}`))
  : undefined;

if (executedFile === fileURLToPath(import.meta.url)) {
  await main();
}
