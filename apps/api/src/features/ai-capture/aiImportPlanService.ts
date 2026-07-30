import type {
  AiImportPlan,
  AiImportPlanStatus,
  PrepareAiImportPlanInput,
} from '@causality/contracts';

import type { AiImportPlanRepository } from './aiImportPlanRepository.js';
import { canonicalizeAiImportPlanInput } from './aiImportPlanCanonicalizer.js';
import { AiCaptureDataError, AiCaptureQualityBlockedError } from './aiCaptureErrors.js';
import { AiCaptureQualityGate, buildQualityReport } from './aiCaptureQualityGate.js';
import {
  parseAiImportPlanInput,
  prepareAiImportMutations,
  qualityReportForPlanValidationError,
} from './aiImportPlanValidator.js';
import type { AiSemanticCandidateService } from './aiSemanticCandidateService.js';

export class AiImportPlanService {
  public constructor(
    private readonly repository: AiImportPlanRepository,
    private readonly semantic: Pick<AiSemanticCandidateService, 'topicRelevance'>,
    private readonly qualityGate = new AiCaptureQualityGate(),
  ) {}

  public async prepare(input: unknown): Promise<AiImportPlan> {
    const parsed: PrepareAiImportPlanInput = parseAiImportPlanInput(input);
    const canonicalInput = canonicalizeAiImportPlanInput(parsed);
    const planReport = this.qualityGate.inspectPlan(canonicalInput);
    if (planReport.status === 'blocked') {
      throw new AiCaptureQualityBlockedError('AI_PLAN_QUALITY_BLOCKED', planReport);
    }
    const state = await this.repository.loadPreparationState(canonicalInput);
    let mutations: ReturnType<typeof prepareAiImportMutations>;
    try {
      mutations = prepareAiImportMutations(canonicalInput, state);
    } catch (error) {
      if (!(error instanceof AiCaptureDataError)) throw error;
      const validationReport = qualityReportForPlanValidationError(error, canonicalInput);
      throw new AiCaptureQualityBlockedError(
        'AI_PLAN_QUALITY_BLOCKED',
        buildQualityReport([...planReport.issues, ...validationReport.issues]),
      );
    }
    const topicRelevance = await this.semantic.topicRelevance(
      canonicalInput.candidates.topic,
      canonicalInput.candidates.atomicEvents,
    );
    const report = buildQualityReport(planReport.issues, topicRelevance);
    const trustedInput: PrepareAiImportPlanInput = {
      ...canonicalInput,
      comparison: { ...canonicalInput.comparison, qualityReport: report },
    };
    return this.repository.createPlan(trustedInput, mutations);
  }

  public status(planId: string): Promise<AiImportPlanStatus> {
    return this.repository.status(planId);
  }

  public get(planId: string): Promise<AiImportPlan> {
    return this.repository.get(planId);
  }
}
