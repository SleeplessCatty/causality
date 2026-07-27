import { describe, expect, it } from 'vitest';

import {
  assertDataCheckBenchmarkTarget,
  assertSemanticDataCheckBenchmarkTarget,
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

  it('requires indexed, capped semantic candidates with bounded Node memory', () => {
    const limits = {
      expectedIssueCount: 50_000,
      maximumPeakRssDeltaBytes: 512 * 1024 ** 2,
    };
    const boundary = {
      issueCount: 50_000,
      status: 'truncated' as const,
      reason: 'candidate_limit' as const,
      peakRssDeltaBytes: limits.maximumPeakRssDeltaBytes,
      usedVectorIndex: true,
    };

    expect(() => assertSemanticDataCheckBenchmarkTarget(boundary, limits)).not.toThrow();
    expect(() =>
      assertSemanticDataCheckBenchmarkTarget({ ...boundary, issueCount: 49_999 }, limits),
    ).toThrow('Semantic benchmark retained 49999 issues; expected 50000');
    expect(() =>
      assertSemanticDataCheckBenchmarkTarget({ ...boundary, usedVectorIndex: false }, limits),
    ).toThrow('Semantic benchmark did not use the pgvector HNSW index');
    expect(() =>
      assertSemanticDataCheckBenchmarkTarget(
        {
          ...boundary,
          peakRssDeltaBytes: limits.maximumPeakRssDeltaBytes + 1,
        },
        limits,
      ),
    ).toThrow('Semantic benchmark peak RSS delta');
  });
});
