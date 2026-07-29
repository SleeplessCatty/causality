import type { AiCaptureQualityReport } from '@causality/contracts';

export type AiCaptureErrorCode =
  | 'AI_EVENT_LIMIT_EXCEEDED'
  | 'AI_CANDIDATE_DEPENDENCY_INVALID'
  | 'AI_CANDIDATE_INVALID'
  | 'AI_CANDIDATE_QUALITY_BLOCKED'
  | 'AI_PLAN_QUALITY_BLOCKED'
  | 'AI_PLAN_INPUT_INVALID'
  | 'AI_PLAN_DECISIONS_INVALID'
  | 'AI_PLAN_REUSE_INVALID'
  | 'AI_PLAN_DEPENDENCY_SKIPPED'
  | 'AI_PLAN_CREATE_EXACT_CONFLICT'
  | 'AI_PLAN_UNIQUE_CONFLICT'
  | 'AI_PLAN_COMPARISON_STALE'
  | 'AI_PLAN_NOT_FOUND'
  | 'AI_PLAN_NOT_REPLACEABLE'
  | 'AI_PLAN_NOT_COMMITTABLE'
  | 'AI_PLAN_NOT_LATEST'
  | 'AI_PLAN_EXPIRED'
  | 'AI_PLAN_DEPENDENCY_CHANGED';

export class AiCaptureDataError extends Error {
  public readonly category = 'data';
  public readonly aiCanRepair = true;
  public readonly retryCurrentPlan = false;

  public constructor(
    public readonly code: AiCaptureErrorCode,
    public readonly affectedRefs: string[] = [],
    message: string = code,
  ) {
    super(message);
    this.name = 'AiCaptureDataError';
  }
}

export class AiCaptureQualityBlockedError extends AiCaptureDataError {
  public constructor(
    code: 'AI_CANDIDATE_QUALITY_BLOCKED' | 'AI_PLAN_QUALITY_BLOCKED',
    public readonly qualityReport: AiCaptureQualityReport,
  ) {
    super(
      code,
      [...new Set(qualityReport.issues.flatMap((issue) => issue.refs))],
      code === 'AI_CANDIDATE_QUALITY_BLOCKED'
        ? '候选集合存在必须修复的质量问题'
        : '入库方案存在必须修复的质量问题',
    );
    this.name = 'AiCaptureQualityBlockedError';
  }
}
