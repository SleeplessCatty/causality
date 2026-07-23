import type {
  ApiErrorCode,
  SemanticModelCode,
  SemanticSettingsResponse,
  SemanticUseModelResponse,
} from '@causality/contracts';

export type SemanticRepositoryErrorCode = Extract<
  ApiErrorCode,
  'SEMANTIC_MODEL_UNAVAILABLE' | 'SEMANTIC_INDEX_FAILED' | 'SEMANTIC_SWITCH_CONFLICT'
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
  setThreshold(modelCode: SemanticModelCode, threshold: number): Promise<void>;
  requestUseModel(modelCode: SemanticModelCode): Promise<SemanticUseModelResponse>;
  retryLatestFailure(): Promise<SemanticUseModelResponse>;
}
