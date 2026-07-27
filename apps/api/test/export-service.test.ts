import type { ExportCounts, ExportPreviewInput } from '@causality/contracts';
import type { Pool, PoolClient, QueryResult } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import {
  ExportRequestError,
  PostgresExportRequestRepository,
  type ExportRequestRepository,
  type StoredExportRequest,
} from '../src/features/data-transfer/exportRequestRepository.js';
import type { ExportScopeRepository } from '../src/features/data-transfer/exportScopeRepository.js';
import {
  ExportService,
  type ExportServiceError,
} from '../src/features/data-transfer/exportService.js';

const startId = '81000000-0000-4000-8000-000000000001';
const fixedNow = new Date('2026-07-27T08:00:00.000Z');

class RecordingScopeRepository implements ExportScopeRepository {
  public readonly inputs: ExportPreviewInput[] = [];

  public constructor(private readonly onMaterialize: () => void = () => undefined) {}

  public async materialize(_client: PoolClient, input: ExportPreviewInput): Promise<ExportCounts> {
    this.inputs.push(input);
    this.onMaterialize();
    return { events: 3, relations: 2, cases: 1 };
  }

  public async *streamEvents(): AsyncIterable<never[]> {
    yield [];
  }

  public async *streamCases(): AsyncIterable<never[]> {
    yield [];
  }

  public async *streamRelations(): AsyncIterable<never[]> {
    yield [];
  }
}

class RecordingRequestRepository implements ExportRequestRepository {
  public readonly creates: Array<{
    input: ExportPreviewInput;
    createdAt: Date;
    expiresAt: Date;
  }> = [];
  public readonly cleanups: Date[] = [];
  public readonly reads: string[] = [];
  public stored: StoredExportRequest | null = null;

  public async create(
    _client: PoolClient,
    input: ExportPreviewInput,
    createdAt: Date,
    expiresAt: Date,
  ): Promise<string> {
    this.creates.push({ input, createdAt, expiresAt });
    return 'a'.repeat(43);
  }

  public async read(_client: PoolClient, rawToken: string): Promise<StoredExportRequest> {
    this.reads.push(rawToken);
    if (!this.stored) throw new ExportRequestError('EXPORT_TOKEN_INVALID', '导出令牌无效');
    return this.stored;
  }

  public async deleteExpired(_client: PoolClient, now: Date): Promise<number> {
    this.cleanups.push(now);
    return 0;
  }
}

function createPool(eventCount = 1): { pool: Pool; queries: string[] } {
  const queries: string[] = [];
  const client = {
    query: vi.fn(async (sql: string) => {
      queries.push(sql);
      if (sql.includes('count(*)')) {
        return { rows: [{ count: String(eventCount) }] } as unknown as QueryResult<{
          count: string;
        }>;
      }
      return { rows: [] } as unknown as QueryResult;
    }),
    release: vi.fn(),
  } as unknown as PoolClient;
  return {
    pool: { connect: vi.fn(async () => client) } as unknown as Pool,
    queries,
  };
}

describe('ExportService', () => {
  it('uses one repeatable-read transaction, normalizes starts, and makes expiry exactly ten minutes', async () => {
    const { pool, queries } = createPool();
    const scope = new RecordingScopeRepository();
    const requests = new RecordingRequestRepository();
    const service = new ExportService(pool, scope, requests, { now: () => fixedNow });

    await expect(
      service.previewExport({
        type: 'filtered',
        startEventIds: [startId, startId],
        direction: 'both',
        depth: 2,
      }),
    ).resolves.toEqual({
      token: 'a'.repeat(43),
      expiresAt: '2026-07-27T08:10:00.000Z',
      counts: { events: 3, relations: 2, cases: 1 },
    });

    expect(queries).toEqual(['begin transaction isolation level repeatable read', 'commit']);
    expect(scope.inputs).toEqual([
      { type: 'filtered', startEventIds: [startId], direction: 'both', depth: 2 },
    ]);
    expect(requests.creates).toEqual([
      {
        input: { type: 'filtered', startEventIds: [startId], direction: 'both', depth: 2 },
        createdAt: fixedNow,
        expiresAt: new Date('2026-07-27T08:10:00.000Z'),
      },
    ]);
    expect(requests.cleanups).toEqual([fixedNow]);
  });

  it('starts the exact configured lifetime only after delayed scope materialization', async () => {
    const { pool } = createPool();
    let clock = new Date('2026-07-27T08:00:00.000Z');
    const issuance = new Date('2026-07-27T08:04:30.000Z');
    const scope = new RecordingScopeRepository(() => {
      clock = issuance;
    });
    const requests = new RecordingRequestRepository();
    const service = new ExportService(pool, scope, requests, {
      now: () => clock,
      tokenLifetimeMs: 90_000,
    });

    await expect(service.previewExport({ type: 'full' })).resolves.toEqual({
      token: 'a'.repeat(43),
      expiresAt: '2026-07-27T08:06:00.000Z',
      counts: { events: 3, relations: 2, cases: 1 },
    });
    expect(requests.cleanups).toEqual([issuance]);
    expect(requests.creates).toEqual([
      {
        input: { type: 'full' },
        createdAt: issuance,
        expiresAt: new Date('2026-07-27T08:06:00.000Z'),
      },
    ]);
  });

  it('rejects a deleted filtered start event during availability without materializing CSV data', async () => {
    const { pool, queries } = createPool(0);
    const scope = new RecordingScopeRepository();
    const requests = new RecordingRequestRepository();
    requests.stored = {
      id: '82000000-0000-4000-8000-000000000001',
      input: { type: 'filtered', startEventIds: [startId], direction: 'downstream', depth: 1 },
      createdAt: fixedNow,
      expiresAt: new Date('2026-07-27T08:10:00.000Z'),
    };
    const service = new ExportService(pool, scope, requests, { now: () => fixedNow });

    await expect(service.checkExportAvailability('a'.repeat(43))).rejects.toMatchObject({
      code: 'EXPORT_START_EVENT_NOT_FOUND',
      message: '起始原子事件不存在',
    } satisfies Partial<ExportServiceError>);
    expect(scope.inputs).toEqual([]);
    expect(queries).toContainEqual(expect.stringContaining('from abstract_events'));
  });

  it('returns stable invalid and expired token errors', async () => {
    const { pool } = createPool();
    const requests = new RecordingRequestRepository();
    const service = new ExportService(pool, new RecordingScopeRepository(), requests, {
      now: () => fixedNow,
    });

    await expect(service.checkExportAvailability('bad token')).rejects.toMatchObject({
      code: 'EXPORT_TOKEN_INVALID',
      message: '导出令牌无效',
    } satisfies Partial<ExportServiceError>);

    requests.stored = {
      id: '82000000-0000-4000-8000-000000000001',
      input: { type: 'full' },
      createdAt: new Date('2026-07-27T07:00:00.000Z'),
      expiresAt: new Date('2026-07-27T07:10:00.000Z'),
    };
    await expect(service.checkExportAvailability('a'.repeat(43))).rejects.toMatchObject({
      code: 'EXPORT_TOKEN_EXPIRED',
      message: '导出令牌已过期',
    } satisfies Partial<ExportServiceError>);
  });
});

describe('PostgresExportRequestRepository', () => {
  it('stores only a SHA-256 hash and filter metadata, never the raw token or export entities', async () => {
    const queries: Array<{ sql: string; values: unknown[] | undefined }> = [];
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        queries.push({ sql, values });
        return { rows: [{ id: '82000000-0000-4000-8000-000000000001' }] };
      }),
    } as unknown as PoolClient;
    const rawToken = 'a'.repeat(43);
    const repository = new PostgresExportRequestRepository({ createToken: () => rawToken });

    await expect(
      repository.create(
        client,
        { type: 'filtered', startEventIds: [startId], direction: 'both', depth: 2 },
        fixedNow,
        new Date('2026-07-27T08:10:00.000Z'),
      ),
    ).resolves.toBe(rawToken);

    expect(queries).toHaveLength(1);
    const query = queries[0]!;
    expect(query.sql).toContain('insert into export_requests');
    expect(query.sql).not.toContain(rawToken);
    expect(query.values).toEqual([
      expect.stringMatching(/^[0-9a-f]{64}$/),
      'filtered',
      [startId],
      'both',
      2,
      expect.any(Date),
      new Date('2026-07-27T08:10:00.000Z'),
    ]);
    expect(query.values).not.toContain(rawToken);
  });
});
