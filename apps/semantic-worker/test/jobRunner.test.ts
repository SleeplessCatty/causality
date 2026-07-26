import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { IndexBuilder } from '../src/jobs/indexBuilder.js';
import type {
  DownloadJob,
  DownloadJobRepository,
  IndexJobRepository,
  LoadJobRepository,
  SemanticLoadJob,
  SemanticIndexJob,
} from '../src/jobs/jobTypes.js';
import { DownloadJobRunner, IndexJobRunner, LoadJobRunner } from '../src/jobs/jobRunner.js';
import { WorkerLeaseLostError } from '../src/jobs/postgresJobSupport.js';
import { ModelHashMismatchError, type ModelDownloader } from '../src/model/modelDownloader.js';
import type { EmbeddingRuntime } from '../src/model/modelRuntime.js';

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
  const failures: Array<{
    stage: 'download' | 'verify';
    kind: 'retryable' | 'manual';
    code: string;
    message: string;
  }> = [];
  const released: string[] = [];
  let claimed = false;

  const repository: DownloadJobRepository = {
    claimNextDownload: async () => {
      if (claimed) return null;
      claimed = true;
      transitions.push('claimed');
      return nextJob;
    },
    renewLease: async () => undefined,
    releaseLease: async (jobId) => {
      released.push(jobId);
      transitions.push('released');
    },
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
    failDownload: async (_jobId, _workerId, stage, failure) => {
      failures.push({ stage, ...failure });
      transitions.push('failed');
    },
    findReadyActiveModel: async () => null,
    isReadyActiveModel: async () => true,
    invalidateActiveModel: async () => true,
    failActiveModelLoad: async () => undefined,
  };

  return { repository, transitions, progress, failures, released };
}

afterEach(async () => {
  vi.useRealTimers();
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
      validateModel: async () => undefined,
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
      validateModel: async () => undefined,
    });

    await expect(runner.runOnce()).resolves.toBe(true);

    expect(fake.transitions).toEqual(['claimed', 'downloading', 'failed']);
    expect(fake.failures).toHaveLength(1);
    expect(fake.failures[0]).toMatchObject({
      stage: 'download',
      kind: 'manual',
    });
    expect(fake.failures[0]!.message.length).toBeLessThanOrEqual(500);
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
      validateModel: async () => undefined,
    });

    await expect(runner.runOnce()).resolves.toBe(false);
    expect(fake.transitions).toEqual(['claimed']);
  });

  it('releases a claimed download without recording failure when shutdown is requested', async () => {
    const fake = fakeRepository();
    const controller = new AbortController();
    const runner = new DownloadJobRunner({
      repository: fake.repository,
      downloader: {
        download: async () => {
          controller.abort();
        },
      },
      modelsDirectory: await temporaryModelDirectory(),
      workerId: 'worker-test',
      validateModel: async () => undefined,
    });

    await expect(runner.runOnce(controller.signal)).resolves.toBe(true);

    expect(fake.transitions).toEqual(['claimed', 'downloading', 'released']);
    expect(fake.failures).toEqual([]);
    expect(fake.released).toEqual([job.id]);
  });

  it('waits for an in-flight lease renewal before final download completion', async () => {
    vi.useFakeTimers();
    let releaseRenewal!: () => void;
    const renewal = new Promise<void>((resolve) => {
      releaseRenewal = resolve;
    });
    let downloadStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      downloadStarted = resolve;
    });
    let finishDownload!: () => void;
    const downloadFinished = new Promise<void>((resolve) => {
      finishDownload = resolve;
    });
    const fake = fakeRepository();
    fake.repository.renewLease = async () => renewal;
    let markVerifying!: () => void;
    const verifying = new Promise<void>((resolve) => {
      markVerifying = resolve;
    });
    fake.repository.markVerifying = async () => {
      fake.transitions.push('verifying');
      markVerifying();
    };
    const runner = new DownloadJobRunner({
      repository: fake.repository,
      downloader: {
        download: async () => {
          downloadStarted();
          await downloadFinished;
        },
      },
      modelsDirectory: await temporaryModelDirectory(),
      workerId: 'worker-test',
      leaseMilliseconds: 3_000,
      validateModel: async () => undefined,
    });

    const running = runner.runOnce();
    await started;
    await vi.advanceTimersByTimeAsync(1_000);
    finishDownload();
    await verifying;

    expect(fake.transitions).toEqual(['claimed', 'downloading', 'verifying']);
    releaseRenewal();
    await expect(running).resolves.toBe(true);
    expect(fake.transitions).toEqual(['claimed', 'downloading', 'verifying', 'completed']);
  });

  it('deletes invalid model files and records a manual verification failure', async () => {
    const modelsDirectory = await temporaryModelDirectory();
    const modelDirectory = join(
      modelsDirectory,
      job.modelCode,
      '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
    );
    await mkdir(modelDirectory, { recursive: true });
    await writeFile(join(modelDirectory, 'corrupt.onnx'), 'corrupt');
    const fake = fakeRepository();
    const runner = new DownloadJobRunner({
      repository: fake.repository,
      downloader: {
        download: async () => undefined,
      },
      modelsDirectory,
      workerId: 'worker-test',
      validateModel: async () => {
        throw new ModelHashMismatchError('corrupt.onnx');
      },
    });

    await expect(runner.runOnce()).resolves.toBe(true);

    await expect(access(modelDirectory)).rejects.toThrow();
    expect(fake.transitions).toEqual(['claimed', 'downloading', 'verifying', 'failed']);
    expect(fake.failures).toEqual([
      {
        stage: 'verify',
        kind: 'manual',
        code: 'MODEL_HASH_MISMATCH',
        message: 'Model file checksum mismatch: corrupt.onnx',
      },
    ]);
  });

  it('persists verification failure before best-effort file cleanup', async () => {
    const fake = fakeRepository();
    const ordering: string[] = [];
    fake.repository.failDownload = async () => {
      ordering.push('failed');
    };
    const runner = new DownloadJobRunner({
      repository: fake.repository,
      downloader: { download: async () => undefined },
      modelsDirectory: await temporaryModelDirectory(),
      workerId: 'worker-test',
      validateModel: async () => {
        throw new ModelHashMismatchError('model.onnx');
      },
      removeModelVersion: async () => {
        ordering.push('cleanup');
        throw new Error('cleanup failed');
      },
    });

    await expect(runner.runOnce()).resolves.toBe(true);
    expect(ordering).toEqual(['failed', 'cleanup']);
  });
});

const loadJob: SemanticLoadJob = {
  id: '31111111-1111-4111-8111-111111111111',
  jobType: 'load',
  modelCode: 'multilingual-e5-small',
  stateVersion: 4,
  attempts: 1,
};

function fakeLoadRepository(nextJob: SemanticLoadJob | null = loadJob, completeCurrent = true) {
  const transitions: string[] = [];
  const failures: Array<{
    stage: 'verify' | 'load';
    kind: 'retryable' | 'manual';
    code: string;
  }> = [];
  const released: string[] = [];
  let claimed = false;
  const repository: LoadJobRepository = {
    claimNextLoad: async () => {
      if (claimed) return null;
      claimed = true;
      transitions.push('claimed');
      return nextJob;
    },
    renewLease: async () => undefined,
    releaseLease: async (jobId) => {
      released.push(jobId);
      transitions.push('released');
    },
    markLoading: async () => {
      transitions.push('loading');
    },
    completeLoad: async () => {
      transitions.push('completed');
      return completeCurrent;
    },
    failLoad: async (_jobId, _workerId, stage, failure) => {
      failures.push({ stage, kind: failure.kind, code: failure.code });
      transitions.push('failed');
    },
    findReadyActiveModel: async () => null,
    isReadyActiveModel: async () => true,
    invalidateActiveModel: async () => true,
    failActiveModelLoad: async () => undefined,
  };
  return { repository, transitions, failures, released };
}

describe('LoadJobRunner', () => {
  it('validates and loads a model before queuing its full index', async () => {
    const fake = fakeLoadRepository();
    const loaded: string[] = [];
    const runtime: EmbeddingRuntime = {
      load: async (_model, target) => {
        loaded.push(target);
      },
      embedQuery: async () => [],
      embedDocuments: async () => [],
      dispose: async () => undefined,
    };
    let activated: SemanticLoadJob['modelCode'] | null = null;
    const runner = new LoadJobRunner({
      repository: fake.repository,
      runtime,
      modelsDirectory: await temporaryModelDirectory(),
      workerId: 'worker-test',
      validateModel: async () => undefined,
      onModelLoaded: (modelCode) => {
        activated = modelCode;
      },
    });

    await expect(runner.runOnce()).resolves.toBe(true);

    expect(fake.transitions).toEqual(['claimed', 'loading', 'completed']);
    expect(loaded).toHaveLength(1);
    expect(activated).toBe(loadJob.modelCode);
  });

  it('keeps valid downloaded files when runtime loading fails', async () => {
    const modelsDirectory = await temporaryModelDirectory();
    const fake = fakeLoadRepository();
    let disposed = false;
    const runner = new LoadJobRunner({
      repository: fake.repository,
      runtime: {
        load: async () => {
          throw Object.assign(new Error('runtime busy'), { code: 'EBUSY' });
        },
        embedQuery: async () => [],
        embedDocuments: async () => [],
        dispose: async () => {
          disposed = true;
        },
      },
      modelsDirectory,
      workerId: 'worker-test',
      validateModel: async () => undefined,
    });

    await expect(runner.runOnce()).resolves.toBe(true);

    expect(fake.transitions).toEqual(['claimed', 'loading', 'failed']);
    expect(fake.failures).toEqual([
      { stage: 'load', kind: 'retryable', code: 'MODEL_LOAD_TRANSIENT' },
    ]);
    expect(disposed).toBe(true);
    await expect(access(modelsDirectory)).resolves.toBeUndefined();
  });

  it('persists load failure even when runtime cleanup fails', async () => {
    const fake = fakeLoadRepository();
    const ordering: string[] = [];
    fake.repository.failLoad = async () => {
      ordering.push('failed');
    };
    const runner = new LoadJobRunner({
      repository: fake.repository,
      runtime: {
        load: async () => {
          throw Object.assign(new Error('runtime busy'), { code: 'EBUSY' });
        },
        embedQuery: async () => [],
        embedDocuments: async () => [],
        dispose: async () => {
          ordering.push('cleanup');
          throw new Error('dispose failed');
        },
      },
      modelsDirectory: await temporaryModelDirectory(),
      workerId: 'worker-test',
      validateModel: async () => undefined,
    });

    await expect(runner.runOnce()).resolves.toBe(true);
    expect(ordering).toEqual(['failed', 'cleanup']);
  });

  it('clears the active runtime and invalidates files when pre-load validation fails', async () => {
    const modelsDirectory = await temporaryModelDirectory();
    const modelDirectory = join(
      modelsDirectory,
      loadJob.modelCode,
      '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
    );
    await mkdir(modelDirectory, { recursive: true });
    const fake = fakeLoadRepository();
    let markedLoading = false;
    let disposed = false;
    const runner = new LoadJobRunner({
      repository: fake.repository,
      runtime: {
        load: async () => undefined,
        embedQuery: async () => [],
        embedDocuments: async () => [],
        dispose: async () => {
          disposed = true;
        },
      },
      modelsDirectory,
      workerId: 'worker-test',
      validateModel: async () => {
        throw new ModelHashMismatchError('model.onnx');
      },
      onModelLoading: () => {
        markedLoading = true;
      },
    });

    await expect(runner.runOnce()).resolves.toBe(true);

    expect(markedLoading).toBe(true);
    expect(disposed).toBe(true);
    await expect(access(modelDirectory)).rejects.toThrow();
    expect(fake.failures).toEqual([
      { stage: 'verify', kind: 'manual', code: 'MODEL_HASH_MISMATCH' },
    ]);
  });

  it('disposes a loaded model when its task is no longer current', async () => {
    const fake = fakeLoadRepository(loadJob, false);
    let disposed = false;
    let activated = false;
    const runner = new LoadJobRunner({
      repository: fake.repository,
      runtime: {
        load: async () => undefined,
        embedQuery: async () => [],
        embedDocuments: async () => [],
        dispose: async () => {
          disposed = true;
        },
      },
      modelsDirectory: await temporaryModelDirectory(),
      workerId: 'worker-test',
      validateModel: async () => undefined,
      onModelLoaded: () => {
        activated = true;
      },
    });

    await expect(runner.runOnce()).resolves.toBe(true);

    expect(disposed).toBe(true);
    expect(activated).toBe(false);
  });

  it('releases a loaded task without publishing it when shutdown is requested', async () => {
    const fake = fakeLoadRepository();
    const controller = new AbortController();
    let disposed = false;
    const runner = new LoadJobRunner({
      repository: fake.repository,
      runtime: {
        load: async () => {
          controller.abort();
        },
        embedQuery: async () => [],
        embedDocuments: async () => [],
        dispose: async () => {
          disposed = true;
        },
      },
      modelsDirectory: await temporaryModelDirectory(),
      workerId: 'worker-test',
      validateModel: async () => undefined,
    });

    await expect(runner.runOnce(controller.signal)).resolves.toBe(true);

    expect(fake.transitions).toEqual(['claimed', 'loading', 'released']);
    expect(fake.failures).toEqual([]);
    expect(fake.released).toEqual([loadJob.id]);
    expect(disposed).toBe(true);
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
  leaseOwner: 'worker-test',
};

function fakeIndexRepository(nextJob: SemanticIndexJob | null) {
  const completed: string[] = [];
  const failures: Array<{
    stage: 'full_index' | 'incremental';
    kind: 'retryable' | 'manual';
    code: string;
    message: string;
  }> = [];
  const released: string[] = [];
  let claimed = false;
  const repository: IndexJobRepository = {
    claimNextIndex: async () => {
      if (claimed) return null;
      claimed = true;
      return nextJob;
    },
    renewLease: async () => undefined,
    releaseLease: async (jobId) => {
      released.push(jobId);
    },
    completeIndex: async (jobId) => {
      completed.push(jobId);
    },
    failIndex: async (_jobId, _workerId, stage, failure) => {
      failures.push({ stage, ...failure });
    },
  };
  return { repository, completed, failures, released };
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
      leaseOwner: 'worker-test',
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
    expect(full.completed).toEqual([]);
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
    expect(fake.failures[0]).toMatchObject({
      stage: 'full_index',
      kind: 'manual',
      code: 'INDEX_VALIDATION_FAILED',
    });
    expect(fake.failures[0]!.message.length).toBeLessThanOrEqual(500);
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

  it('passes a live lease guard into the index builder before state publication', async () => {
    vi.useFakeTimers();
    const leaseFailure = new WorkerLeaseLostError();
    let buildStarted!: () => void;
    let releaseBuild!: () => void;
    const started = new Promise<void>((resolve) => {
      buildStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseBuild = resolve;
    });
    const fake = fakeIndexRepository(fullIndexJob);
    fake.repository.renewLease = async () => {
      throw leaseFailure;
    };
    let receivedLeaseGuard = false;
    const runner = new IndexJobRunner({
      repository: fake.repository,
      builder: {
        buildFull: async (_job, assertLeaseValid?: () => void) => {
          receivedLeaseGuard = assertLeaseValid !== undefined;
          buildStarted();
          await release;
          assertLeaseValid?.();
        },
        buildIncremental: async () => undefined,
      },
      workerId: 'worker-test',
      leaseMilliseconds: 3_000,
    });

    const running = runner.runOnce();
    await started;
    await vi.advanceTimersByTimeAsync(1_000);
    releaseBuild();
    await expect(running).resolves.toBe(true);

    expect(receivedLeaseGuard).toBe(true);
    expect(fake.completed).toEqual([]);
    expect(fake.failures).toEqual([]);
  });

  it('releases an index task without publishing failure when shutdown is requested', async () => {
    const fake = fakeIndexRepository(fullIndexJob);
    const controller = new AbortController();
    const runner = new IndexJobRunner({
      repository: fake.repository,
      builder: {
        buildFull: async () => {
          controller.abort();
        },
        buildIncremental: async () => undefined,
      },
      workerId: 'worker-test',
    });

    await expect(runner.runOnce(controller.signal)).resolves.toBe(true);

    expect(fake.completed).toEqual([]);
    expect(fake.failures).toEqual([]);
    expect(fake.released).toEqual([fullIndexJob.id]);
  });
});
