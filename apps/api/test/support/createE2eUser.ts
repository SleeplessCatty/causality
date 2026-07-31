import { Pool } from 'pg';

import { runUserAdminCommand } from '../../src/commands/userAdmin.js';
import { argon2idPasswordHasher } from '../../src/features/auth/passwordHasher.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const pool = new Pool({ connectionString: databaseUrl });
try {
  await runUserAdminCommand({
    command: 'create',
    pool,
    io: {
      prompt: async () => 'e2e-user',
      write: () => undefined,
    },
    passwordHasher: argon2idPasswordHasher,
    initialPasswordGenerator: () => 'Initial!Causal123',
    clock: () => new Date(),
    requestIdGenerator: () => 'e2e-user-bootstrap',
  });
} finally {
  await pool.end();
}
