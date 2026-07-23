import type {
  DataCheckIssue,
  DataCheckIssueListQuery,
  DataCheckLatestResponse,
} from '@causality/contracts';
import type { Pool, PoolClient, QueryResult } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { DataCheckCoordinator } from '../src/features/data-checks/dataCheckCoordinator.js';
import { DataCheckService } from '../src/features/data-checks/dataCheckService.js';
import type {
  DataCheckRepository,
  DataCheckRule,
  DataCheckScanResult,
  DataCheckScanner,
} from '../src/features/data-checks/dataCheckTypes.js';

const snapshotId = 'a1000000-0000-4000-8000-000000000001';
const issueId = 'b1000000-0000-4000-8000-000000000001';

function latest(status: DataCheckLatestResponse['task']['status']): DataCheckLatestResponse {
  return {
    task: {
      status,
      startedAt: status === 'never_run' ? null : '2026-07-23T09:00:00.000Z',
      finishedAt:
        status === 'running' || status === 'never_run' ? null : '2026-07-23T09:00:01.000Z',
    },
    snapshot: null,
    latestFailure: null,
  };
}

function issue(status: DataCheckIssue['status'] = 'open'): DataCheckIssue {
  return {
    id: issueId,
    snapshotId,
    severity: 'error',
    issueType: 'relation_self_loop',
    description: '因果关系的原因事件与结果事件相同',
    suggestion: '编辑或删除该因果关系',
    actionMode: 'manual',
    status,
    targetType: 'relation',
    targetId: 'c1000000-0000-4000-8000-000000000001',
    relatedId: null,
    handledAt: status === 'handled' ? '2026-07-23T09:01:00.000Z' : null,
  };
}

function scanResult(): DataCheckScanResult {
  return {
    snapshotId,
    checkedAt: new Date('2026-07-23T09:00:01.000Z'),
    orphanCounts: { events: 2, relations: 3, cases: 4 },
    issues: [
      {
        severity: 'error',
        issueType: 'relation_self_loop',
        targetType: 'relation',
        targetId: 'c1000000-0000-4000-8000-000000000001',
        relatedId: null,
        description: '因果关系的原因事件与结果事件相同',
        suggestion: '编辑或删除该因果关系',
        actionMode: 'manual',
      },
    ],
    timings: [{ rule: 'relation_self_loop', milliseconds: 1 }],
  };
}

function createRepository(): DataCheckRepository {
  return {
    tryStart: vi.fn(),
    latest: vi.fn(),
    replaceSnapshot: vi.fn(),
    markFailure: vi.fn(),
    recoverInterrupted: vi.fn(),
    listIssues: vi.fn(),
    autoHandle: vi.fn(),
    manualHandle: vi.fn(),
  };
}

function createScanner(): DataCheckScanner {
  return { run: vi.fn() };
}

describe('DataCheckCoordinator', () => {
  it('attaches concurrent starts to one background scan', async () => {
    const repository = createRepository();
    const scanner = createScanner();
    let releaseScan!: (result: DataCheckScanResult) => void;
    const pendingScan = new Promise<DataCheckScanResult>((resolve) => {
      releaseScan = resolve;
    });

    vi.mocked(repository.tryStart)
      .mockResolvedValueOnce({ started: true, latest: latest('running') })
      .mockResolvedValueOnce({ started: false, latest: latest('running') });
    vi.mocked(scanner.run).mockReturnValue(pendingScan);
    vi.mocked(repository.replaceSnapshot).mockResolvedValue(latest('succeeded'));

    const coordinator = new DataCheckCoordinator(repository, scanner);
    const starts = await Promise.all([coordinator.start(), coordinator.start()]);

    expect(starts).toEqual([latest('running'), latest('running')]);
    expect(repository.tryStart).toHaveBeenCalledTimes(2);
    expect(scanner.run).toHaveBeenCalledTimes(1);

    releaseScan(scanResult());
    await coordinator.waitForCurrent();
    expect(repository.replaceSnapshot).toHaveBeenCalledWith(scanResult());
  });

  it('retains the previous snapshot when a background scan fails', async () => {
    const repository = createRepository();
    const scanner = createScanner();
    const failure = new Error('scan failed');

    vi.mocked(repository.tryStart).mockResolvedValue({
      started: true,
      latest: latest('running'),
    });
    vi.mocked(scanner.run).mockRejectedValue(failure);
    vi.mocked(repository.markFailure).mockResolvedValue(latest('failed'));

    const coordinator = new DataCheckCoordinator(repository, scanner);
    await coordinator.start();
    await coordinator.waitForCurrent();

    expect(repository.replaceSnapshot).not.toHaveBeenCalled();
    expect(repository.markFailure).toHaveBeenCalledWith('scan failed');
  });

  it('marks an interrupted task as failed during recovery', async () => {
    const repository = createRepository();
    const scanner = createScanner();
    vi.mocked(repository.recoverInterrupted).mockResolvedValue(latest('failed'));

    const coordinator = new DataCheckCoordinator(repository, scanner);

    await expect(coordinator.recoverInterrupted()).resolves.toEqual(latest('failed'));
    expect(repository.recoverInterrupted).toHaveBeenCalledOnce();
  });

  it('delegates latest state and issue pagination without starting a scan', async () => {
    const repository = createRepository();
    const scanner = createScanner();
    const query: DataCheckIssueListQuery = { page: 2, severity: 'warning' };
    const response = { items: [], page: 1, pageSize: 50 as const, totalItems: 0, totalPages: 1 };
    vi.mocked(repository.latest).mockResolvedValue(latest('succeeded'));
    vi.mocked(repository.listIssues).mockResolvedValue(response);

    const coordinator = new DataCheckCoordinator(repository, scanner);

    await expect(coordinator.latest()).resolves.toEqual(latest('succeeded'));
    await expect(coordinator.listIssues(query)).resolves.toEqual(response);
    expect(scanner.run).not.toHaveBeenCalled();
  });

  it('delegates idempotent manual handling for the current snapshot', async () => {
    const repository = createRepository();
    const scanner = createScanner();
    vi.mocked(repository.manualHandle).mockResolvedValue(issue('handled'));

    const coordinator = new DataCheckCoordinator(repository, scanner);

    await expect(coordinator.manualHandle(issueId, snapshotId)).resolves.toEqual(issue('handled'));
    expect(repository.manualHandle).toHaveBeenCalledWith(issueId, snapshotId);
  });

  it('returns auto-handler revalidation results and preserves repository errors', async () => {
    const repository = createRepository();
    const scanner = createScanner();
    const unsafe = new Error('DATA_CHECK_AUTO_HANDLE_UNSAFE');
    vi.mocked(repository.autoHandle)
      .mockResolvedValueOnce(issue('handled'))
      .mockRejectedValueOnce(unsafe);

    const coordinator = new DataCheckCoordinator(repository, scanner);

    await expect(coordinator.autoHandle(issueId, snapshotId)).resolves.toEqual(issue('handled'));
    await expect(coordinator.autoHandle(issueId, snapshotId)).rejects.toBe(unsafe);
    expect(repository.autoHandle).toHaveBeenCalledTimes(2);
  });
});

describe('DataCheckService', () => {
  it('scans orphan counts and every rule in one repeatable-read snapshot', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [{ orphan_event_count: '2', orphan_relation_count: '3', orphan_case_count: '4' }],
      } satisfies Partial<QueryResult>),
      release: vi.fn(),
    } as unknown as PoolClient;
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;
    const firstRule: DataCheckRule = {
      issueType: 'relation_self_loop',
      scan: vi.fn().mockResolvedValue(scanResult().issues),
    };
    const secondRule: DataCheckRule = {
      issueType: 'cross_event_shared_alias',
      scan: vi.fn().mockResolvedValue([]),
    };
    const service = new DataCheckService(pool, [firstRule, secondRule], {
      createSnapshotId: () => snapshotId,
      now: () => new Date('2026-07-23T09:00:01.000Z'),
    });

    const result = await service.run();

    expect(vi.mocked(client.query).mock.calls.map(([sql]) => sql)).toEqual([
      'begin transaction isolation level repeatable read read only',
      expect.stringContaining('orphan_event_count'),
      'commit',
    ]);
    expect(firstRule.scan).toHaveBeenCalledWith(client, snapshotId);
    expect(secondRule.scan).toHaveBeenCalledWith(client, snapshotId);
    expect(client.release).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      snapshotId,
      checkedAt: new Date('2026-07-23T09:00:01.000Z'),
      orphanCounts: { events: 2, relations: 3, cases: 4 },
      issues: scanResult().issues,
    });
    expect(result.timings.map(({ rule }) => rule)).toEqual([
      'relation_self_loop',
      'cross_event_shared_alias',
    ]);
  });

  it('rolls back and releases the snapshot client when a rule fails', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{ orphan_event_count: '0', orphan_relation_count: '0', orphan_case_count: '0' }],
        })
        .mockResolvedValueOnce({ rows: [] }),
      release: vi.fn(),
    } as unknown as PoolClient;
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;
    const rule: DataCheckRule = {
      issueType: 'relation_self_loop',
      scan: vi.fn().mockRejectedValue(new Error('rule failed')),
    };
    const service = new DataCheckService(pool, [rule]);

    await expect(service.run()).rejects.toThrow('rule failed');
    expect(client.query).toHaveBeenLastCalledWith('rollback');
    expect(client.release).toHaveBeenCalledOnce();
  });
});
