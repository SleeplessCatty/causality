import type {
  AiImportPlan,
  AiImportPlanStatus,
  PrepareAiImportPlanInput,
} from '@causality/contracts';

import type { AiImportPlanRepository } from './aiImportPlanRepository.js';
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
    const state = await this.repository.loadPreparationState(parsed);
    const topicRelevance = await this.semantic.topicRelevance(
      parsed.candidates.topic,
      parsed.candidates.atomicEvents,
    );
    const planReport = this.qualityGate.inspectPlan(parsed);
    const report = buildQualityReport(planReport.issues, topicRelevance);
    if (report.status === 'blocked') {
      throw new AiCaptureQualityBlockedError('AI_PLAN_QUALITY_BLOCKED', report);
    }
    const trustedInput: PrepareAiImportPlanInput = {
      ...parsed,
      comparison: { ...parsed.comparison, qualityReport: report },
    };
    try {
      const mutations = prepareAiImportMutations(trustedInput, state);
      return await this.repository.createPlan(trustedInput, mutations);
    } catch (error) {
      if (!(error instanceof AiCaptureDataError)) throw error;
      const validationReport = qualityReportForPlanValidationError(error, trustedInput);
      throw new AiCaptureQualityBlockedError(
        'AI_PLAN_QUALITY_BLOCKED',
        buildQualityReport([...report.issues, ...validationReport.issues], report.topicRelevance),
      );
    }
  }

  public status(planId: string): Promise<AiImportPlanStatus> {
    return this.repository.status(planId);
  }

  public get(planId: string): Promise<AiImportPlan> {
    return this.repository.get(planId);
  }
}
