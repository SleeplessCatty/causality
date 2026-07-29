import type { PrepareAiImportPlanInput } from '@causality/contracts';

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function byRef<T extends { ref: string }>(values: readonly T[]): T[] {
  return values.toSorted((left, right) => compareText(left.ref, right.ref));
}

function byLink<T extends { relationRef: string; caseRef: string }>(values: readonly T[]): T[] {
  return values.toSorted(
    (left, right) =>
      compareText(left.relationRef, right.relationRef) || compareText(left.caseRef, right.caseRef),
  );
}

export function canonicalizeAiImportPlanInput(
  input: PrepareAiImportPlanInput,
): PrepareAiImportPlanInput {
  return {
    ...input,
    candidates: {
      ...input.candidates,
      atomicEvents: byRef(input.candidates.atomicEvents),
      concreteCases: byRef(input.candidates.concreteCases),
      causalRelations: byRef(input.candidates.causalRelations),
      relationCaseLinks: byLink(input.candidates.relationCaseLinks),
    },
    comparison: {
      ...input.comparison,
      atomicEvents: byRef(input.comparison.atomicEvents),
      concreteCases: byRef(input.comparison.concreteCases),
      causalRelations: byRef(input.comparison.causalRelations),
      relationCaseLinks: byLink(input.comparison.relationCaseLinks),
    },
    decisions: {
      atomicEvents: byRef(input.decisions.atomicEvents),
      concreteCases: byRef(input.decisions.concreteCases),
      causalRelations: byRef(input.decisions.causalRelations),
      relationCaseLinks: byLink(input.decisions.relationCaseLinks),
    },
  };
}
