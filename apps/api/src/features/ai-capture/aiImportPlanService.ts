import type {
  AiImportPlan,
  AiImportPlanStatus,
  PrepareAiImportPlanInput,
} from '@causality/contracts';

import type { AiImportPlanRepository } from './aiImportPlanRepository.js';
import { parseAiImportPlanInput, prepareAiImportMutations } from './aiImportPlanValidator.js';

export class AiImportPlanService {
  public constructor(private readonly repository: AiImportPlanRepository) {}

  public async prepare(input: unknown): Promise<AiImportPlan> {
    const parsed: PrepareAiImportPlanInput = parseAiImportPlanInput(input);
    const state = await this.repository.loadPreparationState(parsed);
    const mutations = prepareAiImportMutations(parsed, state);
    return this.repository.createPlan(parsed, mutations);
  }

  public status(planId: string): Promise<AiImportPlanStatus> {
    return this.repository.status(planId);
  }
}
