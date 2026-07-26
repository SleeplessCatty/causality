import type {
  SemanticFailure,
  SemanticIndexStatus,
  SemanticModelCode,
  SemanticModelFileStatus,
  SemanticTaskPhase,
  SemanticTaskStatus,
  SemanticTaskType,
  SemanticWorkerStatus,
} from '@causality/contracts';

export interface SemanticModelState {
  modelCode: SemanticModelCode;
  label: string;
  description: string;
  languageLabel: string;
  dimensions: number;
  expectedDownloadBytes: number;
  threshold: number;
  downloadedAt: string | null;
  fileState: SemanticModelFileStatus;
  failure: SemanticFailure | null;
}

export interface SemanticIndexState {
  currentModelCode: SemanticModelCode | null;
  status: SemanticIndexStatus;
  stateVersion: number;
  processedItems: number;
  totalItems: number;
  pendingItems: number;
  failedItems: number;
  failure: SemanticFailure | null;
  updatedAt: string | null;
}

export interface SemanticJobState {
  id: string;
  type: SemanticTaskType;
  status: SemanticTaskStatus;
  phase: SemanticTaskPhase;
  modelCode: SemanticModelCode;
  stateVersion: number;
  attempt: number;
  processedItems: number;
  totalItems: number;
  downloadedBytes: number;
  totalBytes: number;
  nextRetryAt: string | null;
  failure: SemanticFailure | null;
  createdAt: string;
}

export interface SemanticLifecycleResolverInput {
  models: readonly SemanticModelState[];
  index: SemanticIndexState;
  jobs: readonly SemanticJobState[];
  worker: SemanticWorkerStatus;
  now: string;
}

export interface SemanticLifecycleFacts {
  models: SemanticModelState[];
  index: SemanticIndexState;
  jobs: SemanticJobState[];
}
