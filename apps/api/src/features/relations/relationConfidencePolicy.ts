export interface ConfidenceCalculationInput {
  baselineConfidence: number;
  baselineCaseCount: number;
  currentCaseCount: number;
}

export function calculateAutomaticConfidence(input: ConfidenceCalculationInput): number {
  const effectiveBaseline = Math.min(input.baselineConfidence, 99.9999);
  const calculated =
    100 - (100 - effectiveBaseline) * 0.9 ** (input.currentCaseCount - input.baselineCaseCount);
  return Number(Math.max(0, Math.min(99.9999, calculated)).toFixed(4));
}
