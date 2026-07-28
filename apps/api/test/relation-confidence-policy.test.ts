import { describe, expect, it } from 'vitest';

import { calculateAutomaticConfidence } from '../src/features/relations/relationConfidencePolicy.js';

describe('relation confidence policy', () => {
  it('raises confidence with diminishing returns as evidence is added', () => {
    expect(
      calculateAutomaticConfidence({
        baselineConfidence: 10,
        baselineCaseCount: 0,
        currentCaseCount: 3,
      }),
    ).toBe(34.39);
  });

  it('lowers confidence when evidence is removed below the baseline count', () => {
    expect(
      calculateAutomaticConfidence({
        baselineConfidence: 50,
        baselineCaseCount: 5,
        currentCaseCount: 4,
      }),
    ).toBe(44.4444);
  });

  it('restores the exact baseline at its captured evidence count', () => {
    expect(
      calculateAutomaticConfidence({
        baselineConfidence: 73.4567,
        baselineCaseCount: 4,
        currentCaseCount: 4,
      }),
    ).toBe(73.4567);
  });

  it('clamps a large evidence reduction at zero', () => {
    expect(
      calculateAutomaticConfidence({
        baselineConfidence: 10,
        baselineCaseCount: 100,
        currentCaseCount: 0,
      }),
    ).toBe(0);
  });

  it('never reaches one hundred even with abundant evidence', () => {
    expect(
      calculateAutomaticConfidence({
        baselineConfidence: 99.9999,
        baselineCaseCount: 0,
        currentCaseCount: 10_000,
      }),
    ).toBe(99.9999);
  });
});
