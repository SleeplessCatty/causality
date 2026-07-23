import { describe, expect, it } from 'vitest';

import {
  assertDataCheckBenchmarkTarget,
  summarizeRuleTimings,
} from '../src/database/benchmark/dataCheckBenchmark.js';

describe('data-check benchmark statistics', () => {
  it('rounds per-rule and total timings for the report', () => {
    expect(
      summarizeRuleTimings(
        [
          { rule: 'first', milliseconds: 10.126 },
          { rule: 'second', milliseconds: 20.555 },
        ],
        35.678,
      ),
    ).toEqual({
      rules: [
        { rule: 'first', milliseconds: 10.13 },
        { rule: 'second', milliseconds: 20.56 },
      ],
      totalMilliseconds: 35.68,
    });
  });

  it('accepts the 30-second boundary and rejects a slower complete check', () => {
    expect(() => assertDataCheckBenchmarkTarget(30_000, 30_000)).not.toThrow();
    expect(() => assertDataCheckBenchmarkTarget(30_001, 30_000)).toThrow(
      'Data-check benchmark total 30001ms exceeds 30000ms',
    );
  });
});
