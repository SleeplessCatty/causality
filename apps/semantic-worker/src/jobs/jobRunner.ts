import { join } from 'node:path';

import { MODEL_CATALOG } from '@causality/semantic-core';

import {
  classifySemanticFailure,
  type ClassifiedSemanticFailure,
  type SemanticFailureStage,
} from './failureClassifier.js';
import type { IndexBuilder } from './indexBuilder.js';
import type { DownloadJobRepository, IndexJobRepository, LoadJobRepository } from './jobTypes.js';
import { startLeaseHeartbeat } from './leaseHeartbeat.js';
import { WorkerLeaseLostError } from './postgresJobSupport.js';
import type { ModelDownloader } from '../model/modelDownloader.js';
import { removeModelVersion, validateReadyModel } from '../model/modelDownloader.js';
import type { EmbeddingRuntime } from '../model/modelRuntime.js';
import { assertWorkerActive, WorkerShutdownRequestedError } from '../workerShutdown.js';

interface DownloadJobRunnerOptions {
  repository: DownloadJobRepository;
  downloader: ModelDownloader;
  modelsDirectory: string;
  workerId: string;
  leaseMilliseconds?: number;
  now?: () => number;
  validateModel?: typeof validateReadyModel;
  removeModelVersion?: typeof removeModelVersion;
}

export class DownloadJobRunner {
  private readonly leaseMilliseconds: number;
  private readonly now: () => number;
  private readonly validateModel: typeof validateReadyModel;
  private readonly removeModelVersion: typeof removeModelVersion;

  public constructor(private readonly options: DownloadJobRunnerOptions) {
    this.leaseMilliseconds = options.leaseMilliseconds ?? 60_000;
    this.now = options.now ?? Date.now;
    this.validateModel = options.validateModel ?? validateReadyModel;
    this.removeModelVersion = options.removeModelVersion ?? removeModelVersion;
  }

  public async runOnce(signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return false;
    const job = await this.options.repository.claimNextDownload(
      this.options.workerId,
      this.leaseMilliseconds,
    );
    if (!job) return false;

    const heartbeat = startLeaseHeartbeat({
      leaseMilliseconds: this.leaseMilliseconds,
      renew: () =>
        this.options.repository.renewLease(job.id, this.options.workerId, this.leaseMilliseconds),
    });

    let stage: Extract<SemanticFailureStage, 'download' | 'verify'> = 'download';
    try {
      const model = MODEL_CATALOG[job.modelCode];
      const target = join(this.options.modelsDirectory, model.code, model.revision);
      assertWorkerActive(signal);
      heartbeat.assertValid();
      await this.options.repository.markDownloading(job.id, this.options.workerId);

      let lastProgressAt = Number.NEGATIVE_INFINITY;
      let lastLoadedBytes = -1;
      await this.options.downloader.download(
        model,
        target,
        async (loadedBytes, totalBytes) => {
          assertWorkerActive(signal);
          heartbeat.assertValid();
          if (totalBytes !== model.expectedDownloadBytes) {
            throw new Error('Model download total does not match the pinned manifest');
          }
          const now = this.now();
          const isComplete = loadedBytes === totalBytes;
          if (isComplete || now - lastProgressAt >= 250) {
            if (loadedBytes !== lastLoadedBytes) {
              heartbeat.assertValid();
              await this.options.repository.updateDownloadProgress(
                job.id,
                this.options.workerId,
                loadedBytes,
              );
              lastLoadedBytes = loadedBytes;
            }
            lastProgressAt = now;
          }
        },
        signal,
      );

      assertWorkerActive(signal);
      heartbeat.assertValid();
      await this.options.repository.markVerifying(job.id, this.options.workerId);
      stage = 'verify';
      await this.validateModel(model, target);
      await heartbeat.stop();
      assertWorkerActive(signal);
      heartbeat.assertValid();
      await this.options.repository.completeDownload(job.id, this.options.workerId);
    } catch (error) {
      await heartbeat.stop();
      if (error instanceof WorkerShutdownRequestedError || signal?.aborted) {
        await this.options.repository.releaseLease(job.id, this.options.workerId);
        return true;
      }
      let failure = error;
      try {
        heartbeat.assertValid();
      } catch (leaseError) {
        failure = leaseError;
      }
      const classified = classifySemanticFailure(stage, failure);
      const failureStage = isFileValidationFailure(classified) ? 'verify' : stage;
      await this.options.repository.failDownload(
        job.id,
        this.options.workerId,
        failureStage,
        classified,
      );
      if (failureStage === 'verify') {
        const model = MODEL_CATALOG[job.modelCode];
        const target = join(this.options.modelsDirectory, model.code, model.revision);
        try {
          await this.removeModelVersion(model, target);
        } catch {
          // The authoritative failure is already persisted; cleanup can be retried manually.
        }
      }
    } finally {
      await heartbeat.stop();
    }
    return true;
  }
}

function isFileValidationFailure(failure: ClassifiedSemanticFailure): boolean {
  return (
    failure.code === 'MODEL_FILE_MISSING' ||
    failure.code === 'MODEL_SIZE_MISMATCH' ||
    failure.code === 'MODEL_HASH_MISMATCH'
  );
}

interface LoadJobRunnerOptions {
  repository: LoadJobRepository;
  runtime: EmbeddingRuntime;
  modelsDirectory: string;
  workerId: string;
  leaseMilliseconds?: number;
  validateModel?: typeof validateReadyModel;
  onModelLoading?: () => void | Promise<void>;
  onModelLoaded?: (
    modelCode: Parameters<EmbeddingRuntime['load']>[0]['code'],
  ) => void | Promise<void>;
}

export class LoadJobRunner {
  private readonly leaseMilliseconds: number;
  private readonly validateModel: typeof validateReadyModel;

  public constructor(private readonly options: LoadJobRunnerOptions) {
    this.leaseMilliseconds = options.leaseMilliseconds ?? 60_000;
    this.validateModel = options.validateModel ?? validateReadyModel;
  }

  public async runOnce(signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return false;
    const job = await this.options.repository.claimNextLoad(
      this.options.workerId,
      this.leaseMilliseconds,
    );
    if (!job) return false;

    const heartbeat = startLeaseHeartbeat({
      leaseMilliseconds: this.leaseMilliseconds,
      renew: () =>
        this.options.repository.renewLease(job.id, this.options.workerId, this.leaseMilliseconds),
    });
    const model = MODEL_CATALOG[job.modelCode];
    const target = join(this.options.modelsDirectory, model.code, model.revision);
    let stage: Extract<SemanticFailureStage, 'verify' | 'load'> = 'verify';

    try {
      assertWorkerActive(signal);
      heartbeat.assertValid();
      await this.options.onModelLoading?.();
      await this.validateModel(model, target);
      assertWorkerActive(signal);
      stage = 'load';
      await this.options.repository.markLoading(job.id, this.options.workerId);
      await this.options.runtime.load(model, target);
      assertWorkerActive(signal);
      await heartbeat.stop();
      assertWorkerActive(signal);
      heartbeat.assertValid();
      const current = await this.options.repository.completeLoad(job.id, this.options.workerId);
      if (current) {
        await this.options.onModelLoaded?.(model.code);
      } else {
        await this.options.runtime.dispose();
      }
    } catch (error) {
      await heartbeat.stop();
      if (error instanceof WorkerShutdownRequestedError || signal?.aborted) {
        await this.options.repository.releaseLease(job.id, this.options.workerId);
        try {
          await this.options.runtime.dispose();
        } catch {
          // A forced process shutdown remains the bounded fallback for disposal failure.
        }
        return true;
      }
      let failure = error;
      try {
        heartbeat.assertValid();
      } catch (leaseError) {
        failure = leaseError;
      }
      const classified = classifySemanticFailure(stage, failure);
      const failureStage = isFileValidationFailure(classified) ? 'verify' : stage;
      await this.options.repository.failLoad(
        job.id,
        this.options.workerId,
        failureStage,
        classified,
      );
      try {
        await this.options.runtime.dispose();
      } catch {
        // The authoritative failure is already persisted; process shutdown retries disposal.
      }
      if (failureStage === 'verify') {
        try {
          await removeModelVersion(model, target);
        } catch {
          // The invalid file state is persisted even when local cleanup is unavailable.
        }
      }
    } finally {
      await heartbeat.stop();
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

  public async runOnce(signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return false;
    const job = await this.options.repository.claimNextIndex(
      this.options.workerId,
      this.leaseMilliseconds,
    );
    if (!job) return false;

    const heartbeat = startLeaseHeartbeat({
      leaseMilliseconds: this.leaseMilliseconds,
      renew: () =>
        this.options.repository.renewLease(job.id, this.options.workerId, this.leaseMilliseconds),
    });

    try {
      const assertLeaseValid = () => {
        assertWorkerActive(signal);
        heartbeat.assertValid();
      };
      if (job.jobType === 'full_index') {
        await this.options.builder.buildFull(job, assertLeaseValid);
      } else {
        await this.options.builder.buildIncremental(job, assertLeaseValid);
      }
      await heartbeat.stop();
      assertWorkerActive(signal);
      heartbeat.assertValid();
      if (job.jobType === 'incremental') {
        await this.options.repository.completeIndex(job.id, this.options.workerId);
      }
    } catch (error) {
      await heartbeat.stop();
      if (error instanceof WorkerShutdownRequestedError || signal?.aborted) {
        await this.options.repository.releaseLease(job.id, this.options.workerId);
        return true;
      }
      let failure = error;
      try {
        heartbeat.assertValid();
      } catch (leaseError) {
        failure = leaseError;
      }
      if (failure instanceof WorkerLeaseLostError) return true;
      await this.options.repository.failIndex(
        job.id,
        this.options.workerId,
        job.jobType,
        classifySemanticFailure(job.jobType, failure),
      );
    } finally {
      await heartbeat.stop();
    }
    return true;
  }
}
