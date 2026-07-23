import { join } from 'node:path';

import { MODEL_CATALOG } from '@causality/semantic-core';

import type { IndexBuilder } from './indexBuilder.js';
import type { DownloadJobRepository, IndexJobRepository } from './jobRepository.js';
import type { ModelDownloader } from '../model/modelDownloader.js';
import { verifyReadyModel } from '../model/modelDownloader.js';

interface DownloadJobRunnerOptions {
  repository: DownloadJobRepository;
  downloader: ModelDownloader;
  modelsDirectory: string;
  workerId: string;
  leaseMilliseconds?: number;
  now?: () => number;
  verifyModel?: typeof verifyReadyModel;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 500);
}

export class DownloadJobRunner {
  private readonly leaseMilliseconds: number;
  private readonly now: () => number;
  private readonly verifyModel: typeof verifyReadyModel;

  public constructor(private readonly options: DownloadJobRunnerOptions) {
    this.leaseMilliseconds = options.leaseMilliseconds ?? 60_000;
    this.now = options.now ?? Date.now;
    this.verifyModel = options.verifyModel ?? verifyReadyModel;
  }

  public async runOnce(): Promise<boolean> {
    const job = await this.options.repository.claimNextDownload(
      this.options.workerId,
      this.leaseMilliseconds,
    );
    if (!job) return false;

    let leaseFailure: unknown;
    const heartbeat = setInterval(
      () => {
        void this.options.repository
          .renewLease(job.id, this.options.workerId, this.leaseMilliseconds)
          .catch((error: unknown) => {
            leaseFailure = error;
          });
      },
      Math.max(1_000, Math.floor(this.leaseMilliseconds / 3)),
    );
    heartbeat.unref();

    try {
      const model = MODEL_CATALOG[job.modelCode];
      const target = join(this.options.modelsDirectory, model.code, model.revision);
      await this.options.repository.markDownloading(job.id, this.options.workerId);

      let lastProgressAt = Number.NEGATIVE_INFINITY;
      let lastLoadedBytes = -1;
      await this.options.downloader.download(model, target, async (loadedBytes, totalBytes) => {
        if (leaseFailure) throw leaseFailure;
        if (totalBytes !== model.expectedDownloadBytes) {
          throw new Error('Model download total does not match the pinned manifest');
        }
        const now = this.now();
        const isComplete = loadedBytes === totalBytes;
        if (isComplete || now - lastProgressAt >= 250) {
          if (loadedBytes !== lastLoadedBytes) {
            await this.options.repository.updateDownloadProgress(
              job.id,
              this.options.workerId,
              loadedBytes,
            );
            lastLoadedBytes = loadedBytes;
          }
          lastProgressAt = now;
        }
      });

      if (leaseFailure) throw leaseFailure;
      await this.options.repository.markVerifying(job.id, this.options.workerId);
      if (!(await this.verifyModel(model, target))) {
        throw new Error('Downloaded model failed final manifest verification');
      }
      await this.options.repository.completeDownload(job.id, this.options.workerId);
    } catch (error) {
      await this.options.repository.failDownload(
        job.id,
        this.options.workerId,
        errorMessage(error),
      );
    } finally {
      clearInterval(heartbeat);
    }
    return true;
  }
}

interface IndexJobRunnerOptions {
  repository: IndexJobRepository;
  builder: IndexBuilder;
  workerId: string;
  leaseMilliseconds?: number;
}

export class IndexJobRunner {
  private readonly leaseMilliseconds: number;

  public constructor(private readonly options: IndexJobRunnerOptions) {
    this.leaseMilliseconds = options.leaseMilliseconds ?? 60_000;
  }

  public async runOnce(): Promise<boolean> {
    const job = await this.options.repository.claimNextIndex(
      this.options.workerId,
      this.leaseMilliseconds,
    );
    if (!job) return false;

    let leaseFailure: unknown;
    const heartbeat = setInterval(
      () => {
        void this.options.repository
          .renewLease(job.id, this.options.workerId, this.leaseMilliseconds)
          .catch((error: unknown) => {
            leaseFailure = error;
          });
      },
      Math.max(1_000, Math.floor(this.leaseMilliseconds / 3)),
    );
    heartbeat.unref();

    try {
      if (job.jobType === 'full_index') {
        await this.options.builder.buildFull(job);
      } else {
        await this.options.builder.buildIncremental(job);
      }
      if (leaseFailure) throw leaseFailure;
      await this.options.repository.completeIndex(job.id, this.options.workerId);
    } catch (error) {
      await this.options.repository.failIndex(job.id, this.options.workerId, errorMessage(error));
    } finally {
      clearInterval(heartbeat);
    }
    return true;
  }
}
