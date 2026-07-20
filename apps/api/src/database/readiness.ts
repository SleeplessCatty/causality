import type { Pool } from 'pg';

export async function isDatabaseReady(pool: Pool): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
