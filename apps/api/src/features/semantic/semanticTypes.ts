import type {
  ApiErrorCode,
  SemanticActionAccepted,
  SemanticModelCode,
  SemanticSettingsResponse,
} from '@causality/contracts';

export type SemanticRepositoryErrorCode = Extract<
  ApiErrorCode,
  | 'SEMANTIC_MODEL_UNAVAILABLE'
  | 'SEMANTIC_ACTION_NOT_ALLOWED'
  | 'SEMANTIC_HIGH_LEVEL_TASK_ACTIVE'
  | 'SEMANTIC_MODEL_NOT_CURRENT'
>;

export class SemanticRepositoryError extends Error {
  public constructor(
    public readonly code: SemanticRepositoryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SemanticRepositoryError';
  }
}

export interface SemanticRepository {
  getSettings(): Promise<SemanticSettingsResponse>;
}

export interface SemanticCommandRepository {
  useModel(modelCode: SemanticModelCode): Promise<SemanticActionAccepted>;
  retryDownload(modelCode: SemanticModelCode): Promise<SemanticActionAccepted>;
  redownload(modelCode: SemanticModelCode): Promise<SemanticActionAccepted>;
  retryLoad(modelCode: SemanticModelCode): Promise<SemanticActionAccepted>;
  retryFullIndex(modelCode: SemanticModelCode): Promise<SemanticActionAccepted>;
  reindex(): Promise<SemanticActionAccepted>;
}
