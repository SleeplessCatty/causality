export type AiCaptureErrorCode =
  'AI_EVENT_LIMIT_EXCEEDED' | 'AI_CANDIDATE_DEPENDENCY_INVALID' | 'AI_CANDIDATE_INVALID';

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
