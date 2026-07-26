import type { SemanticEntityType, SemanticTaskType } from '@causality/contracts';
import type { SemanticModelCode } from '@causality/semantic-core';

import type { ClassifiedSemanticFailure, SemanticFailureStage } from './failureClassifier.js';

interface SemanticJob {
  id: string;
  modelCode: SemanticModelCode;
  stateVersion: number;
  attempts: number;
}

export interface DownloadJob extends SemanticJob {
  totalBytes: number;
}

export interface SemanticLoadJob extends SemanticJob {
  jobType: 'load';
}

export interface SemanticIndexJob extends SemanticJob {
  jobType: Extract<SemanticTaskType, 'full_index' | 'incremental'>;
  entityType: SemanticEntityType | null;
  entityId: string | null;
}

export interface RecordFailure {
  entityType: SemanticEntityType;
  entityId: string;
  code: 'SOURCE_EMBEDDING_FAILED';
  message: string;
}

export interface ReadyActiveModel {
  modelCode: SemanticModelCode;
  revision: string;
}

export interface ModelFileRepository {
  findReadyActiveModel(): Promise<ReadyActiveModel | null>;
  invalidateActiveModel(
    modelCode: SemanticModelCode,
    failure: ClassifiedSemanticFailure,
  ): Promise<void>;
  failActiveModelLoad(
    modelCode: SemanticModelCode,
    failure: ClassifiedSemanticFailure,
  ): Promise<void>;
}

export interface DownloadJobRepository extends ModelFileRepository {
  claimNextDownload(workerId: string, leaseMilliseconds: number): Promise<DownloadJob | null>;
  renewLease(jobId: string, workerId: string, leaseMilliseconds: number): Promise<void>;
  markDownloading(jobId: string, workerId: string): Promise<void>;
  updateDownloadProgress(jobId: string, workerId: string, loadedBytes: number): Promise<void>;
  markVerifying(jobId: string, workerId: string): Promise<void>;
  completeDownload(jobId: string, workerId: string): Promise<void>;
  failDownload(
    jobId: string,
    workerId: string,
    stage: Extract<SemanticFailureStage, 'download' | 'verify'>,
    failure: ClassifiedSemanticFailure,
  ): Promise<void>;
}

export interface LoadJobRepository extends ModelFileRepository {
  claimNextLoad(workerId: string, leaseMilliseconds: number): Promise<SemanticLoadJob | null>;
  renewLease(jobId: string, workerId: string, leaseMilliseconds: number): Promise<void>;
  markLoading(jobId: string, workerId: string): Promise<void>;
  completeLoad(jobId: string, workerId: string): Promise<boolean>;
  failLoad(
    jobId: string,
    workerId: string,
    stage: Extract<SemanticFailureStage, 'verify' | 'load'>,
    failure: ClassifiedSemanticFailure,
  ): Promise<void>;
}

export interface IndexJobRepository {
  claimNextIndex(workerId: string, leaseMilliseconds: number): Promise<SemanticIndexJob | null>;
  renewLease(jobId: string, workerId: string, leaseMilliseconds: number): Promise<void>;
  completeIndex(jobId: string, workerId: string): Promise<void>;
  failIndex(jobId: string, workerId: string, error: string): Promise<void>;
}

export interface IndexStateRepository {
  isCurrent(job: SemanticIndexJob): Promise<boolean>;
  markModelLoading(job: SemanticLoadJob): Promise<void>;
  beginFullBuild(job: SemanticIndexJob, totalItems: number): Promise<void>;
  updateFullProgress(
    job: SemanticIndexJob,
    processedItems: number,
    totalItems: number,
  ): Promise<void>;
  publishIndex(job: SemanticIndexJob, indexedItems: number, failedItems: number): Promise<boolean>;
  recordSourceFailure(job: SemanticIndexJob, failure: RecordFailure): Promise<void>;
  refreshIncrementalState(job: SemanticIndexJob): Promise<void>;
}
