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
  leaseOwner: string;
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
  stateVersion: number;
  downloadedAt: string;
}

export interface ModelFileRepository {
  findReadyActiveModel(): Promise<ReadyActiveModel | null>;
  isReadyActiveModel(modelCode: SemanticModelCode, stateVersion: number): Promise<boolean>;
  invalidateActiveModel(
    modelCode: SemanticModelCode,
    stateVersion: number,
    downloadedAt: string,
    failure: ClassifiedSemanticFailure,
  ): Promise<boolean>;
  failActiveModelLoad(
    modelCode: SemanticModelCode,
    stateVersion: number,
    failure: ClassifiedSemanticFailure,
  ): Promise<void>;
}

export interface DownloadJobRepository extends ModelFileRepository {
  claimNextDownload(workerId: string, leaseMilliseconds: number): Promise<DownloadJob | null>;
  renewLease(jobId: string, workerId: string, leaseMilliseconds: number): Promise<void>;
  releaseLease(jobId: string, workerId: string): Promise<void>;
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
  releaseLease(jobId: string, workerId: string): Promise<void>;
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
  releaseLease(jobId: string, workerId: string): Promise<void>;
  completeIndex(jobId: string, workerId: string): Promise<void>;
  failIndex(
    jobId: string,
    workerId: string,
    stage: Extract<SemanticFailureStage, 'full_index' | 'incremental'>,
    failure: ClassifiedSemanticFailure,
  ): Promise<void>;
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
