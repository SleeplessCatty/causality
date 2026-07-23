import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { IndexBuilder } from '../src/jobs/indexBuilder.js';
import type {
  DownloadJob,
  DownloadJobRepository,
  IndexJobRepository,
  SemanticIndexJob,
} from '../src/jobs/jobRepository.js';
import { DownloadJobRunner, IndexJobRunner } from '../src/jobs/jobRunner.js';
import type { ModelDownloader } from '../src/model/modelDownloader.js';

const job: DownloadJob = {
  id: '11111111-1111-4111-8111-111111111111',
  modelCode: 'multilingual-e5-small',
  stateVersion: 4,
  attempts: 1,
  totalBytes: 135_392_857,
};

const temporaryDirectories: string[] = [];

async function temporaryModelDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'causality-job-runner-'));
  temporaryDirectories.push(path);
  return path;
}

function fakeRepository(nextJob: DownloadJob | null = job) {
  const transitions: string[] = [];
  const progress: number[] = [];
  const failures: string[] = [];
  let claimed = false;

  const repository: DownloadJobRepository = {
    claimNextDownload: async () => {
      if (claimed) return null;
      claimed = true;
      transitions.push('claimed');
      return nextJob;
    },
    renewLease: async () => undefined,
    markDownloading: async () => {
      transitions.push('downloading');
    },
    updateDownloadProgress: async (_jobId, _workerId, loadedBytes) => {
      progress.push(loadedBytes);
    },
    markVerifying: async () => {
      transitions.push('verifying');
    },
    completeDownload: async () => {
      transitions.push('completed');
    },
    failDownload: async (_jobId, _workerId, error) => {
      failures.push(error);
      transitions.push('failed');
    },
    findReadyActiveModel: async () => null,
    markActiveModelUnavailable: async () => undefined,
  };

  return { repository, transitions, progress, failures };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('DownloadJobRunner', () => {
  it('persists throttled progress and completes a verified download in order', async () => {
    const fake = fakeRepository();
    let now = 0;
    const downloader: ModelDownloader = {
      download: async (_model, _target, onProgress) => {
        await onProgress(100, job.totalBytes);
        now = 100;
        await onProgress(200, job.totalBytes);
        now = 260;
        await onProgress(300, job.totalBytes);
        now = 300;
        await onProgress(job.totalBytes, job.totalBytes);
      },
    };
    const runner = new DownloadJobRunner({
      repository: fake.repository,
      downloader,
      modelsDirectory: await temporaryModelDirectory(),
      workerId: 'worker-test',
      now: () => now,
      verifyModel: async () => true,
    });

    await expect(runner.runOnce()).resolves.toBe(true);

    expect(fake.transitions).toEqual(['claimed', 'downloading', 'verifying', 'completed']);
    expect(fake.progress).toEqual([100, 300, job.totalBytes]);
  });

  it('records a bounded error and keeps the polling loop alive after a failed download', async () => {
    const fake = fakeRepository();
    const downloader: ModelDownloader = {
      download: async () => {
        throw new Error('下载失败'.repeat(300));
      },
    };
    const runner = new DownloadJobRunner({
      repository: fake.repository,
      downloader,
      modelsDirectory: await temporaryModelDirectory(),
      workerId: 'worker-test',
      verifyModel: async () => false,
    });

    await expect(runner.runOnce()).resolves.toBe(true);

    expect(fake.transitions).toEqual(['claimed', 'downloading', 'failed']);
    expect(fake.failures).toHaveLength(1);
    expect(fake.failures[0]!.length).toBeLessThanOrEqual(500);
  });

  it('returns false when no download job is available', async () => {
    const fake = fakeRepository(null);
    const runner = new DownloadJobRunner({
      repository: fake.repository,
      downloader: {
        download: async () => {
          throw new Error('should not run');
        },
      },
      modelsDirectory: await temporaryModelDirectory(),
      workerId: 'worker-test',
      verifyModel: async () => false,
    });

    await expect(runner.runOnce()).resolves.toBe(false);
    expect(fake.transitions).toEqual(['claimed']);
  });
});

const fullIndexJob: SemanticIndexJob = {
  id: '41111111-1111-4111-8111-111111111111',
  jobType: 'full_index',
  modelCode: 'multilingual-e5-small',
  stateVersion: 4,
  attempts: 1,
  entityType: null,
  entityId: null,
};

function fakeIndexRepository(nextJob: SemanticIndexJob | null) {
  const completed: string[] = [];
  const failures: string[] = [];
  let claimed = false;
  const repository: IndexJobRepository = {
    claimNextIndex: async () => {
      if (claimed) return null;
      claimed = true;
      return nextJob;
    },
    renewLease: async () => undefined,
    completeIndex: async (jobId) => {
      completed.push(jobId);
    },
    failIndex: async (_jobId, _workerId, error) => {
      failures.push(error);
    },
  };
  return { repository, completed, failures };
}

describe('IndexJobRunner', () => {
  it('builds and completes full and incremental jobs through the matching path', async () => {
    const built: string[] = [];
    const builder: IndexBuilder = {
      buildFull: async (indexJob) => {
        built.push(`full:${indexJob.id}`);
      },
      buildIncremental: async (indexJob) => {
        built.push(`incremental:${indexJob.id}`);
      },
    };
    const full = fakeIndexRepository(fullIndexJob);
    const fullRunner = new IndexJobRunner({
      repository: full.repository,
      builder,
      workerId: 'worker-test',
    });
    const incrementalJob: SemanticIndexJob = {
      ...fullIndexJob,
      id: '41111111-1111-4111-8111-111111111112',
      jobType: 'incremental',
      entityType: 'event',
      entityId: '10000000-0000-4000-8000-000000000001',
    };
    const incremental = fakeIndexRepository(incrementalJob);
    const incrementalRunner = new IndexJobRunner({
      repository: incremental.repository,
      builder,
      workerId: 'worker-test',
    });

    await expect(fullRunner.runOnce()).resolves.toBe(true);
    await expect(incrementalRunner.runOnce()).resolves.toBe(true);

    expect(built).toEqual([`full:${fullIndexJob.id}`, `incremental:${incrementalJob.id}`]);
    expect(full.completed).toEqual([fullIndexJob.id]);
    expect(incremental.completed).toEqual([incrementalJob.id]);
  });

  it('records a bounded index failure without stopping the polling loop', async () => {
    const fake = fakeIndexRepository(fullIndexJob);
    const runner = new IndexJobRunner({
      repository: fake.repository,
      builder: {
        buildFull: async () => {
          throw new Error('索引失败'.repeat(300));
        },
        buildIncremental: async () => undefined,
      },
      workerId: 'worker-test',
    });

    await expect(runner.runOnce()).resolves.toBe(true);

    expect(fake.completed).toEqual([]);
    expect(fake.failures).toHaveLength(1);
    expect(fake.failures[0]!.length).toBeLessThanOrEqual(500);
  });

  it('returns false when no index job is available', async () => {
    const fake = fakeIndexRepository(null);
    const runner = new IndexJobRunner({
      repository: fake.repository,
      builder: {
        buildFull: async () => undefined,
        buildIncremental: async () => undefined,
      },
      workerId: 'worker-test',
    });

    await expect(runner.runOnce()).resolves.toBe(false);
  });
});
