export type AiCaptureErrorCode =
  | 'AI_EVENT_LIMIT_EXCEEDED'
  | 'AI_CANDIDATE_DEPENDENCY_INVALID'
  | 'AI_CANDIDATE_INVALID'
  | 'AI_PLAN_INPUT_INVALID'
  | 'AI_PLAN_DECISIONS_INVALID'
  | 'AI_PLAN_REUSE_INVALID'
  | 'AI_PLAN_DEPENDENCY_SKIPPED'
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
    message = code,
  ) {
    super(message);
    this.name = 'AiCaptureDataError';
  }
}
