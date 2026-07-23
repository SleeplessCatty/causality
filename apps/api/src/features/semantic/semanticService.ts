import type {
  SemanticModelCode,
  SemanticSettingsResponse,
  SemanticUseModelResponse,
} from '@causality/contracts';

import type { SemanticRepository } from './semanticTypes.js';

export class SemanticService {
  public constructor(private readonly repository: SemanticRepository) {}

  public settings(): Promise<SemanticSettingsResponse> {
    return this.repository.getSettings();
  }

  public async updateThreshold(
    modelCode: SemanticModelCode,
    threshold: number,
  ): Promise<SemanticSettingsResponse> {
    await this.repository.setThreshold(modelCode, threshold);
    return this.repository.getSettings();
  }

  public useModel(modelCode: SemanticModelCode): Promise<SemanticUseModelResponse> {
    return this.repository.requestUseModel(modelCode);
  }

  public retry(): Promise<SemanticUseModelResponse> {
    return this.repository.retryLatestFailure();
  }
}
