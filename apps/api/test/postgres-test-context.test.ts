import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { closePostgresTestPool, startPostgresTestContext } from './support/postgresTestContext.js';

describe('PostgreSQL test context', () => {
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
});
