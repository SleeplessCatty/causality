import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';

type RouteAccess = 'public' | 'business' | 'internal-mcp';

interface RoutePolicyEntry {
  method: string;
  url: string;
  access: RouteAccess;
}

describe('API route access policy', () => {
  it('classifies every API route and exposes only health, readiness, and login publicly', async () => {
    const fakePool = {
      connect: async () => ({
        query: async (sql: string) =>
          sql.includes('select status,')
            ? {
                rows: [
                  {
                    status: 'idle',
                    attempt_started_at: null,
                    attempt_finished_at: null,
                    last_failure_at: null,
                    last_failure_message: null,
                    last_snapshot_id: null,
                    last_success_at: null,
                    orphan_event_count: 0,
                    orphan_relation_count: 0,
                    orphan_case_count: 0,
                    error_count: 0,
                    warning_count: 0,
                    open_count: 0,
                    handled_count: 0,
                    semantic_status: null,
                    semantic_reason: null,
                  },
                ],
              }
            : { rows: [] },
        release: () => undefined,
      }),
    } as unknown as Pool;
    const app = buildApp({
      logger: false,
      databasePool: fakePool,
      internalMcpSecret: 'ef'.repeat(32),
    });
    await app.ready();

    const entries = (app as unknown as { routeAccessPolicy: RoutePolicyEntry[] }).routeAccessPolicy;
    expect(entries.length).toBeGreaterThan(10);
    expect(
      entries.every((entry) => ['public', 'business', 'internal-mcp'].includes(entry.access)),
    ).toBe(true);
    expect(
      entries
        .filter((entry) => entry.access === 'public')
        .map(({ method, url }) => `${method} ${url}`)
        .sort(),
    ).toEqual(['GET /api/health', 'GET /api/ready', 'POST /api/auth/login']);
    expect(entries.find((entry) => entry.url === '/api/events')?.access).toBe('business');
    expect(entries.find((entry) => entry.url === '/api/mcp/tokens/:tokenId/secret')?.access).toBe(
      'business',
    );
    expect(entries.find((entry) => entry.url === '/api/openapi.json')?.access).toBe('business');

    await app.close();
  });
});
