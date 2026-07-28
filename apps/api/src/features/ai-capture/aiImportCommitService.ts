import type { AiImportCommitResult, AiWorkflowError } from '@causality/contracts';

import { AiImportCommitError, classifyAiImportCommitError } from './aiWorkflowErrorClassifier.js';

export interface AiImportCommitRepository {
  commit(planId: string): Promise<AiImportCommitResult>;
  recordFailure(planId: string, error: AiWorkflowError): Promise<void>;
}

export class AiImportCommitService {
  public constructor(private readonly repository: AiImportCommitRepository) {}

  public async commit(planId: string): Promise<AiImportCommitResult> {
    try {
      return await this.repository.commit(planId);
    } catch (error) {
      const workflowError = classifyAiImportCommitError(error);
      try {
        await this.repository.recordFailure(planId, workflowError);
      } catch {
        // The original structured error remains actionable even if PostgreSQL is unavailable.
      }
      throw new AiImportCommitError(workflowError, { cause: error });
    }
  }
}
